from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from transcription.multistem_refiner import STEM_NAMES, SlakhMultistemRefiner  # noqa: E402
from transcription.audio import NormalizedAudio  # noqa: E402
from transcription.demucs_adapter import DemucsSourceSeparator  # noqa: E402


class MultistemRefinerTests(unittest.TestCase):
    def test_model_contract_covers_all_four_analysis_stems(self):
        self.assertEqual(STEM_NAMES, ("bass", "drums", "vocals", "other"))

    def test_refiner_requires_an_existing_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "multistem-mask.pt"
            with patch.dict(os.environ, {"MULTISTEM_REFINER_CHECKPOINT": str(checkpoint)}, clear=True):
                self.assertIsNone(SlakhMultistemRefiner.from_environment())
                checkpoint.write_bytes(b"checkpoint")
                self.assertEqual(SlakhMultistemRefiner.from_environment().checkpoint, checkpoint)

    def test_low_memory_engine_routes_directly_to_all_learned_stems(self):
        class FakeRefiner:
            def separate(self, _source, output):
                output.mkdir(parents=True)
                paths = {stem: output / f"{stem}.wav" for stem in STEM_NAMES}
                for path in paths.values():
                    path.write_bytes(b"wav")
                return paths

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "mix.wav"
            source.write_bytes(b"wav")
            with patch.dict(os.environ, {"SEPARATION_ENGINE": "slakh"}, clear=True), patch(
                "transcription.demucs_adapter.SlakhMultistemRefiner.from_environment", return_value=FakeRefiner()
            ):
                result = DemucsSourceSeparator(root / "outputs").separate(NormalizedAudio(source, 1.0, 44100, 2), "bass")
            self.assertEqual(result.provider, "Slakh full-band four-stem separator")
            self.assertEqual(set(result.stems), set(STEM_NAMES))
            self.assertEqual(result.primary_audio.model_input_path, source)


if __name__ == "__main__":
    unittest.main()
