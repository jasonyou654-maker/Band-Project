from __future__ import annotations

import sys
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SERVICE_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from transcription.contracts import (  # noqa: E402
    AudioAsset,
    BeatGrid,
    PipelineMetadata,
    PipelineStage,
    RawNoteEvent,
    TranscriptionRequest,
    TranscriptionResult,
)
from transcription.routing import SeparationMode, TargetRouter  # noqa: E402
from transcription.basic_pitch_adapter import PROFILES, raw_event_from_basic_pitch  # noqa: E402
from transcription.refinement import RefinementPolicy, refine_events  # noqa: E402
from transcription.adapters import TranscriberOutput  # noqa: E402
from transcription.audio import FfmpegAudioPreprocessor, NormalizedAudio, PassthroughAudioPreprocessor  # noqa: E402
from transcription.pipeline import TranscriptionPipeline  # noqa: E402
from transcription.demucs_adapter import DemucsSourceSeparator  # noqa: E402
from transcription.score import GridRhythmQuantizer  # noqa: E402
from transcription.revisions import ScoreEditOperation, apply_score_operations, correction_training_record  # noqa: E402


class TranscriptionContractTests(unittest.TestCase):
    def test_api_result_keeps_legacy_note_event_shape_and_provenance(self):
        request = TranscriptionRequest(
            request_id="request-1",
            audio=AudioAsset(filename="take.wav", mime_type="audio/wav", byte_size=1024),
            target_instrument="bass",
        )
        event = RawNoteEvent(0.1, 0.5, 40, confidence=0.92, source="basic-pitch")
        result = TranscriptionResult(
            request=request,
            stage=PipelineStage.COMPLETED,
            raw_events=(event,),
            beat_grid=BeatGrid(bpm=120, beats_seconds=(0.0, 0.5), confidence=0.8),
            metadata=PipelineMetadata(pipeline_version="v1", transcriber="basic-pitch"),
            warnings=("Review the draft.",),
            musicxml="<score-partwise/>",
        )
        payload = result.to_api_dict()
        self.assertEqual(payload["noteEvents"][0]["pitch"], 40)
        self.assertEqual(payload["rawNoteEvents"][0]["source"], "basic-pitch")
        self.assertEqual(payload["beatGrid"]["bpm"], 120)
        self.assertEqual(payload["pipeline"]["transcriber"], "basic-pitch")

    def test_invalid_note_boundaries_are_rejected(self):
        with self.assertRaises(ValueError):
            RawNoteEvent(1.0, 1.0, 60)

    def test_non_increasing_beats_are_rejected(self):
        with self.assertRaises(ValueError):
            BeatGrid(beats_seconds=(0.0, 0.5, 0.5))

    def test_mixed_bass_prefers_a_bass_stem(self):
        request = TranscriptionRequest(
            request_id="request-2",
            audio=AudioAsset(filename="song.m4a", mime_type="audio/mp4", byte_size=2048, source_type="mix"),
            target_instrument="bass",
        )
        route = TargetRouter().route(request)
        self.assertEqual(route.separation_mode, SeparationMode.PREFERRED_STEM)
        self.assertEqual(route.preferred_stem, "bass")

    def test_mixed_piano_uses_auxiliary_not_claimed_isolation(self):
        request = TranscriptionRequest(
            request_id="request-3",
            audio=AudioAsset(filename="song.mp3", mime_type="audio/mpeg", byte_size=2048, source_type="mix"),
            target_instrument="piano",
        )
        route = TargetRouter().route(request)
        self.assertEqual(route.separation_mode, SeparationMode.AUXILIARY_STEM)

    def test_basic_pitch_profiles_restrict_known_instrument_ranges(self):
        self.assertLess(PROFILES["bass"].minimum_frequency_hz, PROFILES["guitar"].minimum_frequency_hz)
        self.assertTrue(PROFILES["guitar"].multiple_pitch_bends)
        self.assertFalse(PROFILES["piano"].multiple_pitch_bends)

    def test_basic_pitch_tuple_event_preserves_amplitude_as_confidence(self):
        event = raw_event_from_basic_pitch((0.1, 0.5, 60, 0.75))
        self.assertEqual(event.velocity, 95)
        self.assertEqual(event.confidence, 0.75)

    def test_refinement_merges_same_pitch_without_retrigger_evidence(self):
        events = (
            RawNoteEvent(0.0, 0.2, 60, confidence=0.8),
            RawNoteEvent(0.22, 0.5, 60, confidence=0.7),
        )
        refined, report = refine_events(events, RefinementPolicy(merge_same_pitch_gap_seconds=0.03))
        self.assertEqual(len(refined), 1)
        self.assertEqual(refined[0].end_seconds, 0.5)
        self.assertEqual(report.merged_events, 1)

    def test_refinement_keeps_short_note_with_strong_onset(self):
        events = (RawNoteEvent(0.0, 0.02, 60, confidence=0.05, onset_confidence=0.9),)
        refined, report = refine_events(events)
        self.assertEqual(len(refined), 1)
        self.assertEqual(report.filtered_short_events, 0)

    def test_pipeline_keeps_raw_and_refined_events_with_provenance(self):
        class FakeTranscriber:
            def transcribe(self, audio, target):
                return TranscriberOutput(
                    raw_events=(
                        RawNoteEvent(0.0, 0.2, 60, confidence=0.8),
                        RawNoteEvent(0.22, 0.5, 60, confidence=0.7),
                    ),
                    provider="fake-basic-pitch",
                    version="test",
                    parameters={"target": target},
                )

        request = TranscriptionRequest(
            request_id="request-4",
            audio=AudioAsset(filename="take.wav", mime_type="audio/wav", byte_size=1, source_type="isolated"),
            target_instrument="piano",
        )
        pipeline = TranscriptionPipeline(preprocessor=PassthroughAudioPreprocessor(), transcriber=FakeTranscriber())
        result = pipeline.run(request, Path("take.wav"))
        self.assertEqual(len(result.raw_events), 2)
        self.assertEqual(len(result.refined_events), 1)
        self.assertEqual(result.metadata.transcriber, "fake-basic-pitch")

    def test_ffmpeg_preprocessor_preserves_stereo_for_separation(self):
        request = TranscriptionRequest(
            request_id="request-5",
            audio=AudioAsset(filename="take.m4a", mime_type="audio/mp4", byte_size=10),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.m4a"
            source.write_bytes(b"source")

            def runner(command, **_kwargs):
                if command[0] == "ffprobe":
                    return subprocess.CompletedProcess(command, 0, '{"streams":[{"sample_rate":"44100","channels":2}],"format":{"duration":"1.25"}}', "")
                Path(command[-1]).write_bytes(b"wav")
                return subprocess.CompletedProcess(command, 0, "", "")

            with patch("transcription.audio.shutil.which", return_value="/usr/bin/tool"):
                normalized = FfmpegAudioPreprocessor(root / "normalized", command_runner=runner).normalize(request, source)
            self.assertTrue(normalized.path.exists())
            self.assertEqual(normalized.sample_rate_hz, 44100)
            self.assertEqual(normalized.channels, 2)
            self.assertEqual(normalized.duration_seconds, 1.25)

    def test_demucs_prefers_requested_bass_stem(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            source = root / "normalized.wav"
            source.write_bytes(b"wav")

            def runner(command, **_kwargs):
                stem = output / "htdemucs" / "normalized" / "bass.wav"
                stem.parent.mkdir(parents=True)
                stem.write_bytes(b"bass")
                return subprocess.CompletedProcess(command, 0, "", "")

            audio = NormalizedAudio(source, 1.0, 22050, 1)
            with patch("transcription.demucs_adapter.shutil.which", return_value="/usr/bin/demucs"):
                separated = DemucsSourceSeparator(output, command_runner=runner).separate(audio, "bass")
            self.assertEqual(separated.primary_audio.path.name, "bass.wav")
            self.assertEqual(separated.provider, "Demucs htdemucs")

    def test_grid_quantizer_uses_beat_grid_without_changing_pitch(self):
        event = RawNoteEvent(0.24, 0.76, 64, confidence=0.8)
        score = GridRhythmQuantizer(subdivisions_per_beat=4).quantize(
            (event,),
            BeatGrid(bpm=120, beats_seconds=(0.0, 0.5, 1.0), time_signature=(4, 4)),
            "Clip",
            "piano",
        )
        note = score.measures[0].notes[0]
        self.assertEqual(note.pitch, 64)
        self.assertEqual(note.start_beat, 1 / 2)
        self.assertEqual(note.duration_beats, 1)

    def test_score_operations_are_replayable_and_training_record_is_opt_in(self):
        score = GridRhythmQuantizer().quantize(
            (RawNoteEvent(0.0, 0.5, 60),),
            BeatGrid(bpm=120, beats_seconds=(0.0, 0.5), time_signature=(4, 4)),
            "Clip",
            "piano",
        )
        revision = apply_score_operations(score, (ScoreEditOperation("edit-1", "update", "note-0", pitch=62),))
        self.assertEqual(revision.score.measures[0].notes[0].pitch, 62)
        record = correction_training_record("score-1", revision, "v1", consented=False)
        self.assertFalse(record["consentedForTraining"])
        self.assertEqual(record["operations"][0]["kind"], "update")


if __name__ == "__main__":
    unittest.main()
