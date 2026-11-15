from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_transcription_defaults_to_portable_timestamped_base_model():
    html = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
    js = (ROOT / 'static' / 'browser-whisper-inline-v3.js').read_text(encoding='utf-8')
    assert '<option value="whisper-base" selected>Base · recomendado para más dispositivos (WASM/WebGPU)</option>' in html
    assert "document.querySelector('#browserWhisperModel')?.value || 'whisper-base'" in js
    assert "whisperModel:el('browserWhisperModel')?.value||'whisper-base'" in js
    assert 'whisper-base_timestamped' in js


def test_large_v3_turbo_remains_an_explicit_opt_in_not_the_default():
    html = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
    assert '<option value="whisper-large-v3-turbo">' in html
    assert '<option value="whisper-large-v3-turbo" selected>' not in html
