from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_transcription_is_attached_to_production_form():
    js = (ROOT / 'static/browser-whisper.js').read_text(encoding='utf-8')
    assert 'attachTranscriptToJobForm(vtt)' in js
    assert "name='selected_clip_ranges'" in js
    assert 'form.requestSubmit()' in js
    assert "querySelector('[name=\"rights_confirmed\"]')" in js
    assert 'if (rights?.checked)' in js


def test_legacy_server_submission_is_opt_in_and_requires_rights_confirmation():
    html = (ROOT / 'static/index.html').read_text(encoding='utf-8')
    js = (ROOT / 'static/browser-whisper.js').read_text(encoding='utf-8')
    assert 'id="autoGenerateAfterTranscription"' in html
    assert 'type="checkbox" checked' not in html
    assert 'modo compatibilidad' in html
    assert 'confirmación de derechos' in js
    assert 'if (rights?.checked)' in js
    assert 'form.requestSubmit()' in js

def test_browser_audio_fallback_starts_recording_before_video_playback():
    js = (ROOT / 'static/browser-whisper.js').read_text(encoding='utf-8')
    recorder_start = js.index('recorder.start(1000);')
    video_play = js.index('await video.play();')
    assert recorder_start < video_play
