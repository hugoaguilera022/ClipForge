from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_mp4_audio_track_is_demuxed_without_decoding_entire_video_blob():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert "import('https://esm.sh/mediabunny@1.65.2')" in js
    assert 'new BlobSource(file)' in js
    assert 'new AudioSampleSink(track)' in js
    assert 'sample.toAudioBuffer()' in js
    assert 'captureAudioFromVideo(file)' in js  # compatibility fallback
    assert 'ctx.decodeAudioData(await file.arrayBuffer())' not in js


def test_audio_demux_checks_track_duration_and_empty_audio():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert 'await track.canDecode()' in js
    assert 'input.getDurationFromMetadata()' in js
    assert 'No se pudieron extraer muestras de audio del MP4.' in js
    assert 'sample.close()' in js


def test_imported_project_survives_selecting_its_original_video_after_import():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert 'let importedProjectPendingSource = false' in js
    assert 'importedProjectPendingSource=Boolean(transcriptData?.segments?.length && !sourceFile)' in js
    assert 'Se han conservado ${editableCandidates.length} cortes y la transcripción.' in js
    assert 'no coincide con el vídeo del proyecto' in js


def test_project_transcript_is_not_applied_to_a_different_video():
    js = (ROOT / 'static/browser-whisper.js').read_text()
    assert 'no coincide con el vídeo del proyecto (' in js
    assert 'Se han descartado los cortes y la transcripción' in js
