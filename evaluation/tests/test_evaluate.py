from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


MODULE_PATH = Path(__file__).parents[1] / "evaluate.py"
SPEC = importlib.util.spec_from_file_location("bandproject_evaluate", MODULE_PATH)
assert SPEC and SPEC.loader
evaluation = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = evaluation
SPEC.loader.exec_module(evaluation)


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.tolerances = {
            "onsetSeconds": 0.05,
            "offsetSecondsMinimum": 0.05,
            "offsetDurationRatio": 0.2,
            "beatSeconds": 0.07,
        }

    def test_perfect_notes_score_one(self):
        payload = {"notes": [{"start": 0.0, "end": 0.5, "pitch": 60}]}
        metrics = evaluation.evaluate_case(payload, payload, self.tolerances)
        self.assertEqual(metrics["onsetF1"], 1.0)
        self.assertEqual(metrics["onsetOffsetF1"], 1.0)
        self.assertEqual(metrics["duplicateRate"], 0.0)

    def test_fragmentation_is_measured_separately(self):
        reference = {"notes": [{"start": 0.0, "end": 1.0, "pitch": 60}]}
        prediction = {"noteEvents": [
            {"start": 0.0, "end": 0.45, "pitch": 60},
            {"start": 0.46, "end": 1.0, "pitch": 60},
        ]}
        metrics = evaluation.evaluate_case(reference, prediction, self.tolerances)
        self.assertEqual(metrics["fragments"], 1)
        self.assertEqual(metrics["fragmentationRate"], 1.0)

    def test_wrong_pitch_has_pitch_error_and_no_note_match(self):
        reference = {"notes": [{"start": 0.0, "end": 0.5, "pitch": 60}]}
        prediction = {"notes": [{"start": 0.01, "end": 0.5, "pitch": 61}]}
        metrics = evaluation.evaluate_case(reference, prediction, self.tolerances)
        self.assertEqual(metrics["onsetF1"], 0.0)
        self.assertEqual(metrics["pitchMeanAbsoluteErrorSemitones"], 1.0)

    def test_example_manifest_passes_smoke_gates(self):
        root = Path(__file__).parents[1]
        report = evaluation.evaluate_manifest(root / "manifest.example.json", root / "thresholds.json")
        self.assertTrue(report["passed"])
        self.assertIn("piano", report["byInstrument"])
        self.assertEqual(report["summary"]["beatF1"], 1.0)


if __name__ == "__main__":
    unittest.main()
