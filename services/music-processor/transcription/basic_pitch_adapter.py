"""Spotify Basic Pitch adapter with versioned, instrument-aware defaults."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from time import perf_counter
from typing import Any

from .adapters import TranscriberOutput
from .audio import NormalizedAudio
from .contracts import RawNoteEvent, TargetInstrument


@dataclass(frozen=True)
class BasicPitchProfile:
    minimum_frequency_hz: float | None
    maximum_frequency_hz: float | None
    onset_threshold: float = 0.5
    frame_threshold: float = 0.3
    minimum_note_length_ms: float = 58.0
    multiple_pitch_bends: bool = False
    melodia_trick: bool = False


# These are starting profiles, deliberately recorded in every run. They must be
# tuned against the future musician-reviewed development set, never by ear.
PROFILES: dict[TargetInstrument, BasicPitchProfile] = {
    "bass": BasicPitchProfile(36.0, 523.3, onset_threshold=0.45, frame_threshold=0.28, minimum_note_length_ms=70.0),
    "guitar": BasicPitchProfile(73.4, 1318.5, onset_threshold=0.48, frame_threshold=0.30, minimum_note_length_ms=52.0, multiple_pitch_bends=True),
    "piano": BasicPitchProfile(27.5, 4186.0, onset_threshold=0.5, frame_threshold=0.32, minimum_note_length_ms=45.0),
    "vocals": BasicPitchProfile(65.4, 1046.5, onset_threshold=0.42, frame_threshold=0.26, minimum_note_length_ms=65.0, multiple_pitch_bends=True, melodia_trick=True),
    "drums": BasicPitchProfile(None, None),
    "chords": BasicPitchProfile(55.0, 2093.0, onset_threshold=0.5, frame_threshold=0.32, minimum_note_length_ms=55.0),
    "lead-sheet": BasicPitchProfile(65.4, 1046.5, onset_threshold=0.44, frame_threshold=0.27, minimum_note_length_ms=60.0, melodia_trick=True),
    "auto": BasicPitchProfile(None, None),
}


def raw_event_from_basic_pitch(event: Any, source: str = "basic-pitch") -> RawNoteEvent:
    if isinstance(event, dict):
        start = float(event.get("start_time_s", event.get("start", 0)))
        end = float(event.get("end_time_s", event.get("end", 0)))
        pitch = int(event.get("pitch_midi", event.get("pitch", 60)))
        amplitude = float(event.get("amplitude", event.get("velocity", 100)))
    else:
        start, end, pitch, *rest = event
        amplitude = float(rest[0]) if rest else 0.8
    velocity = round(amplitude * 127) if amplitude <= 1 else round(amplitude)
    confidence = max(0.0, min(1.0, amplitude)) if amplitude <= 1 else None
    return RawNoteEvent(float(start), float(end), int(pitch), max(1, min(127, velocity)), confidence=confidence, source=source)


class BasicPitchTranscriber:
    """Thin adapter; musical cleanup intentionally remains outside Basic Pitch."""

    provider = "Spotify Basic Pitch"

    def __init__(self, artifacts_directory: Path | None = None) -> None:
        self.artifacts_directory = artifacts_directory

    def transcribe(self, audio: NormalizedAudio, target: TargetInstrument) -> TranscriberOutput:
        try:
            from basic_pitch.inference import predict
        except ImportError as error:
            raise RuntimeError("Basic Pitch is not installed in the processing service.") from error
        try:
            basic_pitch_version = version("basic-pitch")
        except PackageNotFoundError:
            basic_pitch_version = None

        profile = PROFILES[target]
        started = perf_counter()
        model_output, midi_data, raw_events = predict(
            str(audio.path),
            onset_threshold=profile.onset_threshold,
            frame_threshold=profile.frame_threshold,
            minimum_note_length=profile.minimum_note_length_ms,
            minimum_frequency=profile.minimum_frequency_hz,
            maximum_frequency=profile.maximum_frequency_hz,
            multiple_pitch_bends=profile.multiple_pitch_bends,
            melodia_trick=profile.melodia_trick,
        )
        artifact_directory = self._artifact_directory(audio.path)
        midi_path = artifact_directory / "basic-pitch.mid" if artifact_directory else None
        raw_output_path = artifact_directory / "basic-pitch-raw.npz" if artifact_directory else None
        if midi_path:
            midi_data.write(str(midi_path))
        if raw_output_path:
            self._save_raw_output(raw_output_path, model_output)
        parameters = asdict(profile)
        parameters["targetInstrument"] = target
        parameters["processingSeconds"] = round(perf_counter() - started, 4)
        return TranscriberOutput(
            raw_events=tuple(raw_event_from_basic_pitch(event) for event in raw_events),
            provider=self.provider,
            version=basic_pitch_version,
            parameters=parameters,
            midi_path=midi_path,
            raw_output_path=raw_output_path,
            warnings=("Raw Basic Pitch events are retained before musical cleanup.",),
        )

    def _artifact_directory(self, source_path: Path) -> Path | None:
        if self.artifacts_directory is None:
            return None
        directory = self.artifacts_directory / source_path.stem
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    @staticmethod
    def _save_raw_output(path: Path, model_output: Any) -> None:
        try:
            import numpy as np
            if isinstance(model_output, dict):
                np.savez_compressed(path, **model_output)
            else:
                np.savez_compressed(path, model_output=model_output)
        except Exception as error:
            raise RuntimeError(f"Could not persist Basic Pitch raw output: {error}") from error
