from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_chunk_results_keep_absolute_timestamps_when_saved_to_project():
    js = (ROOT / "static/browser-whisper.js").read_text()
    assert "start: Number(c.start)" in js
    assert "end: Number(c.end)" in js
    assert "Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start" in js
    # Regression guard: chunk output has {start,end,text}, not timestamp[].
    block = js.split("segments: chunks.map(c => ({", 1)[1].split("})).filter", 1)[0]
    assert "c.timestamp" not in block

def test_absolute_transcript_segments_feed_vtt_and_manual_render_form():
    js = (ROOT / "static/browser-whisper.js").read_text()
    assert "const vtt = makeVtt(transcriptData.segments)" in js
    assert "attachTranscriptToJobForm(vtt)" in js
