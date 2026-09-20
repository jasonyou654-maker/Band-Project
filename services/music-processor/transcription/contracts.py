"""Model-agnostic contracts shared by every transcription pipeline stage.

The source of truth is an event timeline, not MIDI or MusicXML. Those are
derived exports, so a later pipeline can replace Basic Pitch without changing
the API contract or losing provenance.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Literal


TargetInstrument = Literal["guitar", "bass", "piano", "vocals", "drums", "chords", "lead-sheet", "auto"]
SourceType = Literal["isolated", "mix", "unknown"]


class PipelineStage(str, Enum):
    QUEUED = "queued"
    NORMALIZING = "normalizing"
    SEPARATING = "separating"
    TRANSCRIBING = "transcribing"
    REFINING = "refining"
    QUANTIZING = "quantizing"
    ENGRAVING = "engraving"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True)
class AudioAsset:
    filename: str
    mime_type: str
    byte_size: int
    source_type: SourceType = "unknown"
    duration_seconds: float | None = None
    sample_rate_hz: int | None = None
    channels: int | None = None


@dataclass(frozen=True)
class TranscriptionRequest:
    request_id: str
    audio: AudioAsset
    target_instrument: TargetInstrument = "auto"
    preserve_pitch_bends: bool = False
    strict_rhythm: bool = False
    requested_bpm: float | None = None
    requested_key: str | None = None


@dataclass(frozen=True)
class RawNoteEvent:
    """A candidate event before musical cleanup or notation quantization."""

    start_seconds: float
    end_seconds: float
    midi_pitch: int
    velocity: int = 100
    confidence: float | None = None
    onset_confidence: float | None = None
    frame_confidence: float | None = None
    pitch_bend_semitones: tuple[float, ...] = ()
    source: str = "unknown"
    inferred: bool = False

    def __post_init__(self) -> None:
        if self.start_seconds < 0 or self.end_seconds <= self.start_seconds:
            raise ValueError("Raw note event must have a positive duration.")
        if not 0 <= self.midi_pitch <= 127:
            raise ValueError("Raw note event MIDI pitch must be in [0, 127].")
        if not 1 <= self.velocity <= 127:
            raise ValueError("Raw note event velocity must be in [1, 127].")
        for value in (self.confidence, self.onset_confidence, self.frame_confidence):
            if value is not None and not 0 <= value <= 1:
                raise ValueError("Event confidence must be in [0, 1].")


@dataclass(frozen=True)
class BeatGrid:
    bpm: float | None = None
    beats_seconds: tuple[float, ...] = ()
    time_signature: tuple[int, int] | None = None
    confidence: float | None = None

    def __post_init__(self) -> None:
        if self.bpm is not None and self.bpm <= 0:
            raise ValueError("BPM must be positive.")
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("Beat-grid confidence must be in [0, 1].")
        if any(later <= earlier for earlier, later in zip(self.beats_seconds, self.beats_seconds[1:])):
            raise ValueError("Beat times must be strictly increasing.")


@dataclass(frozen=True)
class PipelineMetadata:
    pipeline_version: str
    transcriber: str
    transcriber_version: str | None = None
    separator: str | None = None
    separator_version: str | None = None
    parameters: dict[str, Any] = field(default_factory=dict)
    processing_seconds: float | None = None


@dataclass(frozen=True)
class TranscriptionResult:
    request: TranscriptionRequest
    stage: PipelineStage
    raw_events: tuple[RawNoteEvent, ...] = ()
    refined_events: tuple[RawNoteEvent, ...] = ()
    beat_grid: BeatGrid = field(default_factory=BeatGrid)
    metadata: PipelineMetadata | None = None
    warnings: tuple[str, ...] = ()
    musicxml: str | None = None
    midi_base64: str | None = None
    midi_path: Path | None = None
    raw_output_path: Path | None = None
    canonical_score: Any | None = None

    def to_api_dict(self) -> dict[str, Any]:
        """Keep the established web response while adding provenance fields."""
        events = self.refined_events or self.raw_events
        return {
            "musicXml": self.musicxml or "",
            "midiBase64": self.midi_base64,
            "noteEvents": [
                {
                    "start": event.start_seconds,
                    "end": event.end_seconds,
                    "pitch": event.midi_pitch,
                    "velocity": event.velocity,
                    "confidence": event.confidence,
                    "source": event.source,
                    "inferred": event.inferred,
                }
                for event in events
            ],
            "rawNoteEvents": [
                {
                    "start": event.start_seconds,
                    "end": event.end_seconds,
                    "pitch": event.midi_pitch,
                    "velocity": event.velocity,
                    "confidence": event.confidence,
                    "onsetConfidence": event.onset_confidence,
                    "frameConfidence": event.frame_confidence,
                    "source": event.source,
                }
                for event in self.raw_events
            ],
            "beatGrid": asdict(self.beat_grid),
            "notation": {
                "quantized": self.canonical_score is not None,
                "measureCount": len(self.canonical_score.measures) if self.canonical_score else None,
                "rhythmMode": (
                    "metered" if self.canonical_score and self.beat_grid.time_signature
                    else "pulse" if self.canonical_score and (self.beat_grid.bpm or self.beat_grid.beats_seconds)
                    else "free" if self.canonical_score
                    else None
                ),
            },
            "pipeline": asdict(self.metadata) if self.metadata else None,
            "stage": self.stage.value,
            "warnings": list(self.warnings),
        }
