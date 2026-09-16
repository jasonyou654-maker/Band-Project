"""Interfaces that isolate models from the orchestration pipeline."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .audio import NormalizedAudio
from .contracts import BeatGrid, PipelineMetadata, RawNoteEvent, TargetInstrument


@dataclass(frozen=True)
class SeparationResult:
    primary_audio: NormalizedAudio
    stems: dict[str, Path]
    provider: str
    version: str | None = None
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class TranscriberOutput:
    raw_events: tuple[RawNoteEvent, ...]
    provider: str
    version: str | None
    parameters: dict[str, object]
    midi_path: Path | None = None
    raw_output_path: Path | None = None
    warnings: tuple[str, ...] = ()


class SourceSeparator(Protocol):
    def separate(self, audio: NormalizedAudio, preferred_stem: str | None) -> SeparationResult: ...


class NoteTranscriber(Protocol):
    def transcribe(self, audio: NormalizedAudio, target: TargetInstrument) -> TranscriberOutput: ...


class BeatTracker(Protocol):
    def track(self, audio: NormalizedAudio) -> BeatGrid: ...


def pipeline_metadata(output: TranscriberOutput, *, separator: SeparationResult | None = None) -> PipelineMetadata:
    return PipelineMetadata(
        pipeline_version="transcription-architecture-v1",
        transcriber=output.provider,
        transcriber_version=output.version,
        separator=separator.provider if separator else None,
        separator_version=separator.version if separator else None,
        parameters=output.parameters,
    )

