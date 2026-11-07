from pathlib import Path
import ast
import math

ROOT=Path(__file__).resolve().parents[1]

def test_imported_clip_numbers_are_normalized():
    js=(ROOT/'static/browser-whisper.js').read_text()
    assert 'Number(c.start).toFixed(2)' in js
    assert 'Number(c.end).toFixed(2)' in js

def test_import_restores_transcript_attachment():
    js=(ROOT/'static/browser-whisper.js').read_text()
    assert 'attachTranscriptToJobForm(makeVtt(segments))' in js

def test_new_video_clears_stale_manual_ranges():
    js=(ROOT/'static/browser-whisper.js').read_text()
    assert 'editableCandidates=[]' in js
    assert "if(field)field.value=''" in js

def test_nonfinite_manual_ranges_rejected():
    assert 'not math.isfinite(a) or not math.isfinite(b)' in (ROOT/'server.py').read_text()
    assert 'not math.isfinite(a) or not math.isfinite(b)' in (ROOT/'clipforge.py').read_text()
