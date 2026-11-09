from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_long_audio_is_transcribed_in_bounded_windows():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert 'async function transcribeAudioInChunks(asr, audio' in js
    assert 'const windowSeconds = 28' in js
    assert 'const overlapSeconds = 2' in js
    assert 'audio.subarray(startSample, endSample)' in js
    assert 'return_timestamps: timestampMode' in js
    assert "model === 'whisper-small' ? true : 'word'" in js


def test_chunked_transcription_restores_absolute_timestamps_and_progress():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert 'const offset = startSample / sampleRate' in js
    assert 'offset + localStart' in js
    assert 'onProgress(Math.min(100' in js
    assert 'Transcribiendo vídeo: ${percent}%' in js


def test_overlap_words_are_not_added_twice():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert 'if (part > 0 && absoluteStart < offset + overlapSeconds) continue' not in js
    assert 'Math.abs(previous.start - absoluteStart) < 0.45' in js
    assert 'Math.abs(previous.start - absoluteStart) < 0.45' in js


def test_transcription_no_longer_sends_full_three_minute_audio_as_one_request():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert 'await transcribeAudioInChunks(asr, audio' in js
    assert 'await asr(audio, {' not in js


def test_chunk_deduplication_normalizes_real_whitespace_not_literal_backslash_s():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert r".replace(/\s+/g, ' ').trim()" in js
    assert r".replace(/\\s+/g, ' ').trim()" not in js
