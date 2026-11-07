import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import clipforge


class FasterWhisperAdapterTests(unittest.TestCase):
    def setUp(self):
        clipforge._FASTER_WHISPER_MODELS.clear()

    def test_normalizes_word_timestamps_and_transcript_metadata(self):
        class Word:
            def __init__(self, start, end, word, probability=0.9):
                self.start, self.end, self.word, self.probability = start, end, word, probability

        class Segment:
            start, end, text = 0.1, 1.4, " Hola mundo."
            words = [Word(0.1, 0.55, " Hola"), Word(0.56, 1.4, " mundo.")]

        class Info:
            language = "es"
            language_probability = 0.99

        class Model:
            def __init__(self, name, device, compute_type):
                self.config = (name, device, compute_type)

            def transcribe(self, *args, **kwargs):
                self.kwargs = kwargs
                return iter([Segment()]), Info()

        fake = types.ModuleType("faster_whisper")
        fake.WhisperModel = Model
        with patch.dict(sys.modules, {"faster_whisper": fake}):
            result = clipforge._transcribe_faster_whisper(Path("official.mp4"), "small", "es")
        self.assertEqual(result["engine"], "faster-whisper")
        self.assertEqual(result["language"], "es")
        self.assertEqual(result["segments"][0]["text"], "Hola mundo.")
        self.assertEqual(result["segments"][0]["words"][1]["start"], 0.56)

    def test_model_is_cached_between_jobs(self):
        created = []
        class Segment:
            start, end, text, words = 0.0, 1.0, "hola", []
        class Info:
            language, language_probability = "es", 0.99
        class Model:
            def __init__(self, *args, **kwargs): created.append(args)
            def transcribe(self, *args, **kwargs): return iter([Segment()]), Info()
        fake = types.ModuleType("faster_whisper")
        fake.WhisperModel = Model
        with patch.dict(sys.modules, {"faster_whisper": fake}):
            clipforge._transcribe_faster_whisper(Path("a.mp4"), "base", "es")
            clipforge._transcribe_faster_whisper(Path("b.mp4"), "base", "es")
        self.assertEqual(len(created), 1)

    def test_empty_result_is_reported_as_transcription_failure(self):
        class Info:
            language, language_probability = "es", 0.99
        class Model:
            def __init__(self, *args, **kwargs): pass
            def transcribe(self, *args, **kwargs): return iter([]), Info()
        fake = types.ModuleType("faster_whisper")
        fake.WhisperModel = Model
        with patch.dict(sys.modules, {"faster_whisper": fake}):
            with self.assertRaisesRegex(RuntimeError, "no reconoció voz"):
                clipforge._transcribe_faster_whisper(Path("silent.mp4"), "base", "es")

    def test_health_and_ui_advertise_mlx_apple_silicon_and_portable_fallbacks(self):
        root = Path(__file__).resolve().parents[1]
        server = (root / "server.py").read_text()
        html = (root / "static/index.html").read_text()
        self.assertIn("'mlx_whisper':mlx_available", server)
        self.assertIn("engine='mlx-whisper'", server)
        self.assertIn("'whisper_cpp':cpp_available", server)
        self.assertIn("ollama_rerank_windows", (root / "clipforge.py").read_text())
        self.assertIn('value="small" selected>Whisper Small', html)
        self.assertIn("localmente con MLX Whisper en Apple Silicon, Faster-Whisper o whisper.cpp", html)


class MlxWhisperAdapterTests(unittest.TestCase):
    def test_normalizes_word_timestamps_and_model_metadata(self):
        fake = types.ModuleType("mlx_whisper")
        fake.transcribe = lambda *a, **kw: {
            "language": "es", "segments": [{"start": 0.1, "end": 1.2, "text": " Hola mundo.",
            "words": [{"start": 0.1, "end": 0.5, "word": " Hola"},
                      {"start": 0.51, "end": 1.2, "word": " mundo."}]}]}
        with patch.object(clipforge.platform, "system", return_value="Darwin"), \
             patch.object(clipforge.platform, "machine", return_value="arm64"), \
             patch.dict(sys.modules, {"mlx_whisper": fake}):
            result = clipforge._transcribe_mlx_whisper(Path("interview.mp4"), "small", "es")
        self.assertEqual(result["engine"], "mlx-whisper")
        self.assertEqual(result["language"], "es")
        self.assertEqual(result["segments"][0]["words"][1]["start"], 0.51)
        self.assertEqual(result["model"], "mlx-community/whisper-small")


    def test_mlx_model_can_be_overridden_to_large_v3_turbo(self):
        fake = types.ModuleType("mlx_whisper")
        fake.transcribe = lambda *a, **kw: {
            "language": "es", "segments": [{"start": 0.1, "end": 0.8, "text": " prueba",
            "words": [{"start": 0.1, "end": 0.8, "word": " prueba"}]}]}
        with (
            patch.object(clipforge.platform, "system", return_value="Darwin"),
            patch.object(clipforge.platform, "machine", return_value="arm64"),
            patch.dict(sys.modules, {"mlx_whisper": fake}),
            patch.dict("os.environ", {"CLIPFORGE_MLX_MODEL": "large-v3-turbo"}),
        ):
            result = clipforge._transcribe_mlx_whisper(Path("interview.mp4"), "small", "es")
        self.assertEqual(result["model"], "mlx-community/whisper-large-v3-turbo")

    def test_macos_launcher_defaults_to_large_v3_turbo_but_allows_override(self):
        launcher = (Path(__file__).resolve().parents[1] / "Iniciar_ClipForge.command").read_text()
        self.assertIn('CLIPFORGE_MLX_MODEL="${CLIPFORGE_MLX_MODEL:-large-v3-turbo}"', launcher)

    def test_refuses_non_apple_silicon(self):
        with patch.object(clipforge.platform, "system", return_value="Linux"), \
             self.assertRaisesRegex(RuntimeError, "requiere macOS"):
            clipforge._transcribe_mlx_whisper(Path("input.mp4"), "small", "es")


class WhisperCppAdapterTests(unittest.TestCase):
    def test_normalizes_json_with_word_timestamps(self):
        import json, tempfile
        from pathlib import Path
        payload = {"transcription": [{
            "timestamps": {"from": "00:00:00,100", "to": "00:00:01,400"},
            "text": " Hola mundo.",
            "tokens": [
                {"text": " Hola", "timestamps": {"from": "00:00:00,100", "to": "00:00:00,550"}},
                {"text": " mundo.", "timestamps": {"from": "00:00:00,560", "to": "00:00:01,400"}},
            ]
        }]}
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "transcript.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = clipforge._parse_whisper_cpp_json(path, "es", "small")
        self.assertEqual(result["engine"], "whisper.cpp")
        self.assertEqual(result["segments"][0]["text"], "Hola mundo.")
        self.assertAlmostEqual(result["segments"][0]["words"][1]["start"], 0.56)

    def test_empty_whisper_cpp_json_fails_closed(self):
        import json, tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "empty.json"
            path.write_text(json.dumps({"transcription": []}), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "sin segmentos"):
                clipforge._parse_whisper_cpp_json(path, "es", "small")


class LocalSemanticRerankerTests(unittest.TestCase):
    def test_returns_none_when_ollama_is_unavailable(self):
        candidates = [{"start": 0, "end": 30, "duration": 30, "text": "momento uno"},
                      {"start": 40, "end": 70, "duration": 30, "text": "momento dos"}]
        with patch("urllib.request.urlopen", side_effect=OSError("offline")):
            self.assertIsNone(clipforge.ollama_rerank_windows(candidates, 1, "es"))

    def test_ollama_selects_only_valid_candidate_ids_and_never_supplies_timestamps(self):
        candidates = [
            {"start": 0, "end": 30, "duration": 30, "text": "candidato uno"},
            {"start": 40, "end": 70, "duration": 30, "text": "candidato dos"},
            {"start": 80, "end": 110, "duration": 30, "text": "candidato tres"},
        ]
        class Response:
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return self.payload
        replies = [
            Response(b'{"models":[{"name":"qwen2.5:3b"}]}'),
            Response(__import__("json").dumps({"message":{"content":__import__("json").dumps({"selected":[{"id":2,"reason":"gancho fuerte"}]})}}).encode()),
        ]
        with patch("urllib.request.urlopen", side_effect=replies):
            result = clipforge.ollama_rerank_windows(candidates, 1, "es")
        self.assertEqual(result[0]["text"], "candidato tres")
        self.assertEqual(result[0]["start"], 80)
        self.assertEqual(result[0]["ai_editorial_rank"], 1)
        self.assertEqual(result[0]["ai_editorial_reason"], "gancho fuerte")


if __name__ == "__main__":
    unittest.main()
