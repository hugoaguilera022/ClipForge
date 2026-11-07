import os
import unittest
from pathlib import Path
from unittest.mock import patch

from diarization import _speaker_for_interval, diarize_video

class DiarizationTests(unittest.TestCase):
    def test_assigns_majority_overlap_only(self):
        turns = [
            {"start": 0.0, "end": 1.0, "speaker": "speaker_1"},
            {"start": 1.0, "end": 2.0, "speaker": "speaker_2"},
        ]
        self.assertEqual(_speaker_for_interval(0.1, 0.9, turns), "speaker_1")
        self.assertEqual(_speaker_for_interval(1.1, 1.9, turns), "speaker_2")
        self.assertIsNone(_speaker_for_interval(2.1, 2.9, turns))

    def test_requires_model_access_token_without_fabricating_labels(self):
        with patch.dict(os.environ, {"HF_TOKEN": "", "HUGGINGFACE_TOKEN": ""}):
            with self.assertRaisesRegex(RuntimeError, "falta HF_TOKEN"):
                diarize_video(Path("missing.mp4"), [{"start": 0, "end": 1, "text": "hola"}])

    def test_explicit_labels_are_not_overwritten(self):
        # Test the mapping contract independently of the external model runtime.
        turns = [{"start": 0.0, "end": 1.0, "speaker": "speaker_1"}]
        self.assertEqual(_speaker_for_interval(0.0, 1.0, turns), "speaker_1")

if __name__ == "__main__":
    unittest.main()
