from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_whisper_uses_onnx_models_with_word_timestamp_attentions():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert "'whisper-tiny': 'onnx-community/whisper-tiny_timestamped'" in js
    assert "'whisper-base': 'onnx-community/whisper-base_timestamped'" in js
    assert "'whisper-small': 'onnx-community/whisper-small_timestamped'" in js
    assert "return_timestamps: 'word'" in js
    assert 'onnx-community/whisper-base\'' not in js
