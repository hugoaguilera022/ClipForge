from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def test_transcript_editor_applies_timestamp_preserving_corrections():
    js=(ROOT/'static/browser-whisper.js').read_text()
    assert "output?.addEventListener('change', applyTranscriptEdits)" in js
    assert 'attachTranscriptToJobForm(makeVtt(parsed))' in js
    assert 'conserva una línea por segmento' in js

def test_project_export_preserves_transcript_and_clip_edits():
    js=(ROOT/'static/browser-whisper.js').read_text()
    assert "schema: 'clipforge-browser-project-v1'" in js
    assert 'transcript: transcriptData' in js
    assert 'clips: editableCandidates.map' in js
    assert "a.download = 'clipforge-proyecto.json'" in js

def test_project_import_restores_editable_transcript_and_attaches_it():
    js=(ROOT/'static/browser-whisper.js').read_text()
    assert 'output.value=segments.map' in js
    assert 'attachTranscriptToJobForm(makeVtt(segments))' in js

def test_ui_explains_original_video_must_be_reselected():
    html=(ROOT/'static/index.html').read_text()
    assert 'tendrás que volver a seleccionar el vídeo original' in html
    assert 'saveBrowserProject' in html

def test_manual_ranges_get_duration_before_review_generation():
    source=(ROOT/'clipforge.py').read_text()
    assert 'item.setdefault("duration",b-a)' in source
    assert 'item["start"]=a; item["end"]=b' in source
