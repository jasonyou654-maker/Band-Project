from pathlib import Path
import math
import struct
import sys
import tempfile
import unittest
import wave


SERVICE_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from transcription.audio import NormalizedAudio
from transcription.beat_tracking import EnergyBeatTracker
from transcription.contracts import AudioAsset, BeatGrid, PipelineMetadata, PipelineStage, RawNoteEvent, TranscriptionRequest, TranscriptionResult
from transcription.musical_analysis import estimate_chords, estimate_key, summarize_transcription


class MusicalAnalysisTests(unittest.TestCase):
    def test_key_and_chords_require_note_evidence(self):
        self.assertEqual(estimate_key(()), {"key": None, "mode": None, "confidence": 0})
        self.assertEqual(estimate_chords(()), {"labels": [], "confidence": 0})

    def test_summary_uses_transcribed_events(self):
        events = tuple(
            RawNoteEvent(start, start + 3.5, pitch, 100, confidence=0.9, source="test")
            for start in (0.0, 4.0, 8.0)
            for pitch in (60, 64, 67)
        )
        request = TranscriptionRequest("request", AudioAsset("c-major.wav", "audio/wav", 100))
        result = TranscriptionResult(
            request=request,
            stage=PipelineStage.COMPLETED,
            raw_events=events,
            refined_events=events,
            beat_grid=BeatGrid(bpm=90, confidence=0.8),
            metadata=PipelineMetadata("test", "test", parameters={"durationSeconds": 12.0}),
        )
        summary = summarize_transcription(result)
        self.assertEqual(summary["bpm"], 90)
        # A repeated C triad alone is relative-key ambiguous, so the global key
        # must stay blank instead of being forced.
        self.assertIsNone(summary["key"])
        self.assertIsNone(summary["mode"])
        self.assertEqual(summary["chords"], ["C"])
        self.assertEqual(summary["noteCount"], 9)

        melodic_events = tuple(
            RawNoteEvent(index, index + 0.8, pitch, 100, confidence=0.9, source="test")
            for index, pitch in enumerate((60, 60, 60, 64, 67, 67, 71, 62, 65, 69))
        )
        melodic_key = estimate_key(melodic_events)
        self.assertEqual(melodic_key["key"], "C")
        self.assertEqual(melodic_key["mode"], "major")

    def test_constant_tone_does_not_claim_a_tempo(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "constant.wav"
            with wave.open(str(path), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(8000)
                output.writeframes(b"".join(struct.pack("<h", 5000) for _ in range(8000 * 4)))
            grid = EnergyBeatTracker().track(NormalizedAudio(path, 4.0, 8000, 1))
        self.assertIsNone(grid.bpm)

    def test_strong_four_beat_accents_produce_tempo_and_meter(self):
        sample_rate = 8000
        duration = 16
        events = tuple(
            RawNoteEvent(
                beat * 0.5,
                beat * 0.5 + 0.2,
                60 + beat % 4,
                velocity=127 if beat % 4 == 0 else 40,
                confidence=0.99,
            )
            for beat in range(32)
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "four-four.wav"
            frames = []
            for index in range(sample_rate * duration):
                seconds = index / sample_rate
                beat = int(seconds * 2)
                phase = seconds - beat * 0.5
                accent = 1.0 if beat % 4 == 0 else 0.15
                value = accent * math.exp(-phase * 50) * math.sin(2 * math.pi * 700 * seconds)
                frames.append(struct.pack("<h", round(value * 32767)))
            with wave.open(str(path), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(sample_rate)
                output.writeframes(b"".join(frames))
            grid = EnergyBeatTracker().track_with_events(NormalizedAudio(path, duration, sample_rate, 1), events)
        self.assertEqual(grid.bpm, 120)
        self.assertEqual(grid.time_signature, (4, 4))


if __name__ == "__main__":
    unittest.main()
