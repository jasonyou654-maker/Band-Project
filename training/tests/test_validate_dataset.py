from __future__ import annotations

import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
from validate_dataset import validate  # noqa: E402


def manifest() -> dict:
    return {
        "schemaVersion": 1,
        "dataset": {"name": "set", "purpose": "evaluation", "license": "licensed", "owner": "owner"},
        "assets": [{"id": "piano-1", "split": "validation", "instrument": "piano", "sourceType": "isolated", "audioPath": "private/audio.wav", "referencePath": "private/reference.musicxml", "license": "licensed", "consentedForTraining": False}],
    }


class DatasetManifestTests(unittest.TestCase):
    def test_valid_manifest_is_accepted(self):
        self.assertEqual(validate(manifest()), [])

    def test_duplicate_id_and_missing_consent_are_rejected(self):
        value = manifest()
        value["assets"].append({**value["assets"][0], "consentedForTraining": "yes"})
        errors = validate(value)
        self.assertTrue(any("id must be unique" in error for error in errors))
        self.assertTrue(any("consentedForTraining" in error for error in errors))

    def test_unlicensed_or_invalid_split_is_rejected(self):
        value = manifest()
        value["assets"][0]["license"] = ""
        value["assets"][0]["split"] = "production"
        errors = validate(value)
        self.assertTrue(any("license" in error for error in errors))
        self.assertTrue(any("split" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
