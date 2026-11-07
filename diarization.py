"""Optional acoustic speaker diarization via pyannote.audio.

Requires a Hugging Face token with access to pyannote/speaker-diarization-community-1
and the model dependencies. No speaker identity is inferred; labels are anonymous.
"""
from __future__ import annotations
import os, shutil, subprocess, tempfile
from pathlib import Path
from typing import Any

MODEL = "pyannote/speaker-diarization-community-1"

def _overlap(a: float, b: float, c: float, d: float) -> float:
    return max(0.0, min(b, d) - max(a, c))

def _speaker_for_interval(start: float, end: float, turns: list[dict[str, Any]]) -> str | None:
    totals: dict[str, float] = {}
    for turn in turns:
        amount = _overlap(start, end, turn["start"], turn["end"])
        if amount:
            totals[turn["speaker"]] = totals.get(turn["speaker"], 0.0) + amount
    if not totals:
        return None
    speaker, amount = max(totals.items(), key=lambda item: item[1])
    return speaker if amount >= (end - start) * 0.20 else None

def diarize_video(video: Path, segments: list[dict[str, Any]]) -> dict[str, Any]:
    """Run pyannote on the complete source and annotate transcript segments/words."""
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if not token:
        raise RuntimeError("Diarización acústica solicitada, pero falta HF_TOKEN. Acepta las condiciones de acceso de pyannote/speaker-diarization-community-1 y configura el token en el entorno local.")
    try:
        from pyannote.audio import Pipeline
    except Exception as exc:
        raise RuntimeError(f"No se pudo importar pyannote.audio: {exc}") from exc
    try:
        pipeline = Pipeline.from_pretrained(MODEL, token=token)
        if pipeline is None:
            raise RuntimeError("pyannote no devolvió un pipeline; revisa el acceso al modelo.")
        with tempfile.TemporaryDirectory(prefix="clipforge_diarization_") as td:
            audio = Path(td) / "audio.wav"
            ffmpeg = shutil.which("ffmpeg")
            if not ffmpeg:
                raise RuntimeError("FFmpeg es necesario para preparar el audio de diarización.")
            proc = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(audio)], capture_output=True, text=True)
            if proc.returncode:
                raise RuntimeError("No se pudo extraer el audio: " + proc.stderr[-1200:])
            diarization = pipeline(str(audio))
        turns = []
        annotation = getattr(diarization, "speaker_diarization", diarization)
        for segment, _, label in annotation.itertracks(yield_label=True):
            a, b = float(segment.start), float(segment.end)
            if b > a:
                turns.append({"start": a, "end": b, "speaker": str(label)})
        if not turns:
            raise RuntimeError("El modelo terminó sin detectar turnos de voz.")
        # Canonicalize labels by first appearance so results are stable and anonymous.
        labels = {}
        for turn in sorted(turns, key=lambda x: (x["start"], x["end"])):
            labels.setdefault(turn["speaker"], f"speaker_{len(labels) + 1}")
            turn["speaker"] = labels[turn["speaker"]]
        for row in segments:
            # Never overwrite explicitly supplied labels.
            if row.get("speaker_id") is None:
                row["speaker_id"] = _speaker_for_interval(float(row["start"]), float(row["end"]), turns)
            for word in row.get("words", []) or []:
                if word.get("speaker_id") is None:
                    word["speaker_id"] = _speaker_for_interval(float(word["start"]), float(word["end"]), turns)
        return {"engine": "pyannote.audio", "model": MODEL, "turns": turns,
                "speakers": [{"id": label} for label in labels.values()],
                "speaker_count": len(labels), "status": "completed"}
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            raise
        raise RuntimeError(f"Falló la diarización pyannote: {exc}") from exc
