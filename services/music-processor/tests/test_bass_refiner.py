from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from transcription.bass_refiner import BabySlakhBassRefiner  # noqa: E402


class BassRefinerTests(unittest.TestCase):
    def test_refiner_is_disabled_without_a_checkpoint(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(BabySlakhBassRefiner.from_environment())

    def test_refiner_requires_an_existing_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "bass-mask.pt"
            with patch.dict(os.environ, {"BASS_REFINER_CHECKPOINT": str(checkpoint)}, clear=True):
                self.assertIsNone(BabySlakhBassRefiner.from_environment())
                checkpoint.write_bytes(b"checkpoint")
                self.assertEqual(BabySlakhBassRefiner.from_environment().checkpoint, checkpoint)


if __name__ == "__main__":
    unittest.main()
