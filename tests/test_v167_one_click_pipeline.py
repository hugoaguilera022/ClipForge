from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_transcription_is_attached_to_production_form():
    js = (ROOT / 'static/browser-whisper-inline-v3.js').read_text(encoding='utf-8')
    assert 'attachTranscriptToJobForm(vtt)' in js
    assert "name='selected_clip_ranges'" in js
    assert 'form.requestSubmit()' in js
    assert "querySelector('[name=\"rights_confirmed\"]')" in js
    assert 'if (rights?.checked)' in js


def test_one_click_option_requires_explicit_rights_confirmation():
    html = (ROOT / 'static/index.html').read_text(encoding='utf-8')
    js = (ROOT / 'static/browser-whisper-inline-v3.js').read_text(encoding='utf-8')
    assert 'id="autoGenerateAfterTranscription"' in html
    assert 'name="rights_confirmed"' in html
    assert 'rights?.checked' in js
    assert 'marca primero la confirmación de derechos' in js
