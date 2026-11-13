from pathlib import Path
import ast
import math

ROOT=Path(__file__).resolve().parents[1]

def test_imported_clip_numbers_are_normalized():
    js=(ROOT/'static/browser-whisper-inline-v3.js').read_text()
    assert "Number.isFinite(Number(c.start))" in js
    assert "Number.isFinite(Number(c.end))" in js
    assert "Number(c.end)<=Number(c.start)" in js
    assert "start:Number(c.start),end:Number(c.end)" in js

def test_import_restores_transcript_attachment():
    js=(ROOT/'static/browser-whisper-inline-v3.js').read_text()
    assert "attachTranscriptToJobForm(makeVtt(segments))" in js
    assert "showClipCandidates([],duration,editableCandidates)" in js

def test_new_video_clears_stale_manual_ranges():
    js=(ROOT/'static/browser-whisper-inline-v3.js').read_text()
    assert "document.querySelector('#video')?.addEventListener('change'" in js
    assert 'editableCandidates=[]' in js
    assert "if (field) field.value='';" in js

def test_nonfinite_manual_ranges_rejected():
    assert 'not math.isfinite(a) or not math.isfinite(b)' in (ROOT/'server.py').read_text()
    assert 'not math.isfinite(a) or not math.isfinite(b)' in (ROOT/'clipforge.py').read_text()
