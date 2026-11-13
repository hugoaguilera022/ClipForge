from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_whisper_uses_word_and_phrase_timestamp_modes():
    js = (ROOT / 'static/browser-whisper-inline-v3.js').read_text()
    assert "'whisper-tiny': 'onnx-community/whisper-tiny_timestamped'" in js
    assert "'whisper-base': 'onnx-community/whisper-base_timestamped'" in js
    assert "return_timestamps: timestampMode" in js
    assert "transcribeAudioInChunks(asr, audio, reportProgress, 'word', sourceLanguage)" in js
    assert 'averageTokensPerSegment>1.7' in js
    assert 'phraseTimed?1.15:.55' in js
    assert 'onnx-community/whisper-base\'' not in js
    assert 'const minLen = 15, maxLen = 45, targetLen = 24;' in js
    assert 'buildEditorialCandidatePool(transcriptData.segments, audio.length / 16000, audio, visualSamples, 16000)' in js
    assert 'candidatePool = await aiEditorialSelect(candidatePool, requested, say)' in js
    assert 'const requested=4;' in js
    assert 'no se presentan cortes heurísticos como selección IA' in js
    assert 'let asrModelId = null;' in js
    assert 'asrModelId !== modelId' in js
    assert 'Whisper Small ha fallado. Cambiando automáticamente a Whisper Base' in js
    assert 'if (!asr || asrModelId !== modelId)' in js
    html = (ROOT / 'static/index.html').read_text()
    assert 'value="whisper-large-v3-turbo" selected' in html
    assert 'value="whisper-small" selected' not in html
    assert 'src="/browser-whisper-inline-v3.js?v=' in html
    assert 'whisper-small' in html and 'vuelve automáticamente a Base' in html
