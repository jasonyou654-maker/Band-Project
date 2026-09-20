from __future__ import annotations

from pathlib import Path
import sys
import unittest

SERVICE_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from transcription.fast_spectral_adapter import FastSpectralTranscriber  # noqa: E402


class FastSpectralTranscriberTests(unittest.TestCase):
    def test_sustained_frames_become_one_note(self):
        events = FastSpectralTranscriber._merge_frames(
            [{45: 0.8}, {45: 0.9}, {45: 0.7}, {}, {}],
            0.032,
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].midi_pitch, 45)
        self.assertAlmostEqual(events[0].end_seconds, 0.096)

    def test_single_frame_noise_is_discarded(self):
        self.assertEqual(FastSpectralTranscriber._merge_frames([{60: 0.9}, {}, {}], 0.032), ())


if __name__ == "__main__":
    unittest.main()
