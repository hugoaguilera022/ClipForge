import json
from pathlib import Path
import mlx.core as mx
import mlx_whisper

audio = Path("test-output/spanish.wav")
if not audio.is_file():
    raise SystemExit("Spanish audio fixture is missing")
result = mlx_whisper.transcribe(
    str(audio),
    path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
    language="es",
    word_timestamps=True,
    condition_on_previous_text=False,
)
text = result.get("text", "").strip()
segments = result.get("segments", [])
words = [word for segment in segments for word in segment.get("words", [])]
assert text, "Whisper returned empty transcription"
assert segments, "Whisper returned no segments"
assert words, "Whisper returned no word timestamps"
assert "prueba" in text.lower() or "transcrip" in text.lower(), text
Path("test-output/transcript.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("MLX device:", mx.default_device())
print("Transcript:", text)
print("Segments:", len(segments), "word timestamps:", len(words))
