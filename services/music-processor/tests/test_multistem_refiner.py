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


if __name__ == "__main__":
    unittest.main()
