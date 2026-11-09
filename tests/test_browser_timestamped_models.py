from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_whisper_uses_word_and_phrase_timestamp_modes():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert "'whisper-tiny': 'onnx-community/whisper-tiny_timestamped'" in js
    assert "'whisper-base': 'onnx-community/whisper-base_timestamped'" in js
    assert "return_timestamps: timestampMode" in js
    assert "model === 'whisper-small' ? true : 'word'" in js
    assert 'averageTokensPerSegment>1.7' in js
    assert 'phraseTimed?1.15:.55' in js
    assert 'onnx-community/whisper-base\'' not in js
    assert 'const minLen = 15, maxLen = 45, targetLen = 24;' in js
    assert 'visualSamples, 12);' in js, 'semantic reranking must compare a broad shortlist before choosing four clips'
    assert 'let asrModelId = null;' in js
    assert 'asrModelId !== modelId' in js
    assert 'Small no pudo cargarse o generar tiempos utilizables. Cambiando automáticamente a Base' in js
    assert 'if (!asr || asrModelId !== modelId)' in js
    html = (ROOT / 'static/index.html').read_text()
    assert 'value="whisper-base" selected' in html
    assert 'value="whisper-small" selected' not in html
    assert 'src="/browser-whisper.js"' in html
    assert 'whisper-small' in html and 'vuelve automáticamente a Base' in html
