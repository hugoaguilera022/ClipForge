from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_whisper_uses_word_and_phrase_timestamp_modes():
    js = (ROOT / 'static/browser-whisper-inline-v3.js').read_text()
    assert "async function transcribeAudioInChunks(asr, audio, onProgress = () => {}, timestampMode = 'word', language = null)" in js
    assert "return_timestamps: timestampMode" in js
    assert "language: language === 'es' ? 'spanish' : language === 'en' ? 'english' : undefined" in js
    assert "rawChunks = Array.isArray(result.chunks) ? result.chunks : []" in js
    assert "start: Number(offset.toFixed(2))" in js
    assert "candidatePool = await aiEditorialSelect(candidatePool, requested, say)" in js
    assert "const requested=4;" in js
    assert "recordDailyAIClips(candidatePool.length)" in js
    assert "let asrModelId = null;" in js
    assert "asrModelId !== modelId" in js
    html = (ROOT / 'static/index.html').read_text()
    assert 'value="whisper-base" selected' in html
    assert 'value="whisper-small"' in html and 'value="whisper-base"' in html
    assert 'value="auto" selected' in html
    assert 'src="/browser-whisper-inline-v3.js?v=' in html
