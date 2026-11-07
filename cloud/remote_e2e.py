#!/usr/bin/env python3
"""Remote end-to-end proof: ASR -> highlight windows -> subtitles -> MP4 validation."""
from __future__ import annotations
import json, os, re, subprocess, sys
from pathlib import Path
from faster_whisper import WhisperModel

ROOT = Path("cloud-output")
ROOT.mkdir(exist_ok=True)
VIDEO = Path(os.environ.get("VIDEO_PATH", "input.mp4"))
MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
MAX_CLIPS = int(os.environ.get("MAX_CLIPS", "3"))

def run(cmd):
    subprocess.run(cmd, check=True)

def stamp(t):
    ms = max(0, int(round(t * 1000)))
    h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"

def ass_time(t):
    cs = max(0, int(round(t * 100)))
    h, cs = divmod(cs, 360000); m, cs = divmod(cs, 6000); s, cs = divmod(cs, 100)
    return f"{h}:{m:02}:{s:02}.{cs:02}"

def main():
    if not VIDEO.exists():
        raise SystemExit(f"Missing source video: {VIDEO}")
    model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=4)
    seg_iter, info = model.transcribe(
        str(VIDEO), language="es", beam_size=5, word_timestamps=True,
        vad_filter=True, condition_on_previous_text=False
    )
    segments = list(seg_iter)
    words = []
    transcript = []
    for i, seg in enumerate(segments):
        text = (seg.text or "").strip()
        transcript.append({"start": seg.start, "end": seg.end, "text": text})
        for w in (seg.words or []):
            words.append({"start": w.start, "end": w.end, "text": w.word.strip()})
    if not transcript or not words:
        raise RuntimeError("ASR produced no transcript/word timestamps")
    (ROOT / "transcript.json").write_text(json.dumps({
        "source": str(VIDEO), "model": MODEL, "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration, "text": " ".join(x["text"] for x in transcript),
        "segments": transcript, "words": words
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "transcript.txt").write_text(
        "\n".join(f'[{x["start"]:.2f}-{x["end"]:.2f}] {x["text"]}' for x in transcript),
        encoding="utf-8"
    )

    # Rank 25-55 s windows by conversational density, question/answer cues,
    # lexical variety and non-silent word coverage; avoid synthetic/fixed timestamps.
    duration = float(info.duration)
    candidates = []
    for start in range(0, max(1, int(duration - 24)), 8):
        end = min(duration, start + 42)
        ws = [w for w in words if w["start"] >= start and w["end"] <= end]
        if len(ws) < 28 or end - start < 22:
            continue
        text = " ".join(w["text"] for w in ws).lower()
        unique = len(set(re.findall(r"[\wáéíóúñü]+", text)))
        question = text.count("?") + sum(text.count(x) for x in ("¿", "qué", "cómo", "por qué", "cuál"))
        hooks = sum(text.count(x) for x in ("pero", "porque", "hostia", "madre", "increíble", "nunca", "siempre", "joder"))
        coverage = min(1.0, len(ws) / max(1, (end-start)*2.2))
        score = unique * 0.12 + question * 1.4 + hooks * 0.9 + coverage * 12
        candidates.append((score, start, end, ws, text))
    selected = []
    for item in sorted(candidates, reverse=True):
        _, start, end, *_ = item
        if all(end <= old[1] or start >= old[2] for old in selected):
            selected.append((item[0], start, end, item[3], item[4]))
        if len(selected) >= MAX_CLIPS:
            break
    if not selected:
        raise RuntimeError("No viable highlight windows found from the real transcript")

    for n, (_, start, end, ws, _) in enumerate(sorted(selected, key=lambda x:x[1]), 1):
        clip = ROOT / f"clip_{n:02}.mp4"
        srt = ROOT / f"clip_{n:02}.srt"
        with srt.open("w", encoding="utf-8") as f:
            for j, w in enumerate(ws, 1):
                a, b = max(0, w["start"]-start), max(0.08, w["end"]-start)
                if b <= a: b = a + 0.08
                f.write(f"{j}\n{stamp(a)} --> {stamp(b)}\n{w['text']}\n\n")
        # Render portrait with burned word-level subtitles, sourced only from ASR timings.
        srt_filter = str(srt.resolve()).replace("\\", "/").replace(":", "\\:")
        vf = f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles='{srt_filter}':force_style='FontName=Arial,FontSize=18,Outline=2,Shadow=1,Alignment=2,MarginV=140'"
        run(["ffmpeg","-y","-ss",f"{start:.3f}","-i",str(VIDEO),"-t",f"{end-start:.3f}",
             "-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","22",
             "-c:a","aac","-b:a","160k","-movflags","+faststart",str(clip)])
        probe = json.loads(subprocess.check_output([
            "ffprobe","-v","error","-show_entries","format=duration:stream=codec_name,width,height",
            "-of","json",str(clip)], text=True))
        streams = probe["streams"]
        v = next(x for x in streams if x.get("codec_name") == "h264")
        a = next(x for x in streams if x.get("codec_name") == "aac")
        d = float(probe["format"]["duration"])
        assert v["width"] == 1080 and v["height"] == 1920, v
        assert 20 <= d <= 60, d
        assert a["codec_name"] == "aac"
        print(f"PASS clip_{n:02}: {d:.2f}s, 1080x1920, H.264/AAC, words={len(ws)}")
    report = {
        "status":"passed", "model":MODEL, "language":info.language,
        "duration":info.duration, "transcript_segments":len(transcript),
        "word_timestamps":len(words), "clips":len(selected),
        "checks":["real_asr","word_timestamps","transcript_nonempty","portrait_1080x1920","h264_aac","duration_20_60s"]
    }
    (ROOT/"validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False))

if __name__ == "__main__":
    main()
