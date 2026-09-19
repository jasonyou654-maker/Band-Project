"""Stable domain contracts for BandProject audio transcription."""

from .contracts import (
    AudioAsset,
    BeatGrid,
    PipelineMetadata,
    RawNoteEvent,
    TranscriptionRequest,
    TranscriptionResult,
)
from .routing import SeparationMode, TargetRoute, TargetRouter
from .basic_pitch_adapter import BasicPitchProfile, BasicPitchTranscriber, PROFILES
from .refinement import RefinementPolicy, RefinementReport, refine_events
from .score import CanonicalScore, GridRhythmQuantizer, Music21ScoreExporter, QuantizedNote, RhythmQuantizer, ScoreMeasure
from .pipeline import TranscriptionPipeline
from .demucs_adapter import DemucsSourceSeparator
from .bass_refiner import BabySlakhBassRefiner
from .beat_tracking import EnergyBeatTracker, LibrosaBeatTracker
from .revisions import ScoreEditOperation, ScoreRevision, apply_score_operations, correction_training_record

__all__ = [
    "AudioAsset",
    "BeatGrid",
    "PipelineMetadata",
    "RawNoteEvent",
    "TranscriptionRequest",
    "TranscriptionResult",
    "SeparationMode",
    "TargetRoute",
    "TargetRouter",
    "BasicPitchProfile",
    "BasicPitchTranscriber",
    "PROFILES",
    "RefinementPolicy",
    "RefinementReport",
    "refine_events",
    "CanonicalScore",
    "GridRhythmQuantizer",
    "Music21ScoreExporter",
    "QuantizedNote",
    "RhythmQuantizer",
    "ScoreMeasure",
    "TranscriptionPipeline",
    "DemucsSourceSeparator",
    "BabySlakhBassRefiner",
    "EnergyBeatTracker",
    "LibrosaBeatTracker",
    "ScoreEditOperation",
    "ScoreRevision",
    "apply_score_operations",
    "correction_training_record",
]
