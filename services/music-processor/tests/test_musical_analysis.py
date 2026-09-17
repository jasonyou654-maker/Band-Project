from pathlib import Path
import struct
import tempfile
import unittest
import wave

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
        self.assertEqual(estimate_key(melodic_events)["key"], "C")

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


if __name__ == "__main__":
    unittest.main()
