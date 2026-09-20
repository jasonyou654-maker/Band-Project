from __future__ import annotations

from fractions import Fraction
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

SERVICE_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from transcription.contracts import BeatGrid, RawNoteEvent  # noqa: E402
from transcription.score import CanonicalScore, NativeScoreExporter, QuantizedNote, ScoreMeasure  # noqa: E402


class NativeScoreExporterTests(unittest.TestCase):
    def test_exports_parseable_musicxml_and_standard_midi(self):
        source = RawNoteEvent(0.0, 0.5, 45, velocity=90, confidence=0.8)
        score = CanonicalScore(
            title="Fast",
            target_instrument="bass",
            beat_grid=BeatGrid(),
            measures=(ScoreMeasure(1, (QuantizedNote(45, Fraction(0), Fraction(1, 2), source_event=source),)),),
        )
        with tempfile.TemporaryDirectory() as directory:
            exports = NativeScoreExporter().export(score, Path(directory))
            self.assertEqual(exports.midi_path.read_bytes()[:4], b"MThd")
            root = ET.parse(exports.musicxml_path).getroot()
            self.assertEqual(root.tag, "score-partwise")
            self.assertEqual(root.findtext("./part-list/score-part/part-name"), "Electric Bass")


if __name__ == "__main__":
    unittest.main()
