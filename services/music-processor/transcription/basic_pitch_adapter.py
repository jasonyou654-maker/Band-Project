"""Spotify Basic Pitch adapter with versioned, instrument-aware defaults."""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from threading import Lock
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
    "piano": BasicPitchProfile(27.5, 4186.0, onset_threshold=0.46, frame_threshold=0.29, minimum_note_length_ms=48.0),
    "vocals": BasicPitchProfile(65.4, 1046.5, onset_threshold=0.42, frame_threshold=0.26, minimum_note_length_ms=65.0, multiple_pitch_bends=True, melodia_trick=True),
    "drums": BasicPitchProfile(None, None),
    "chords": BasicPitchProfile(55.0, 2093.0, onset_threshold=0.46, frame_threshold=0.29, minimum_note_length_ms=58.0),
    "lead-sheet": BasicPitchProfile(65.4, 1046.5, onset_threshold=0.44, frame_threshold=0.27, minimum_note_length_ms=60.0, melodia_trick=True),
    # Dual-pass agreement below lets auto recover weak attacks without keeping
    # every low-level artefact found in only one representation of a muddy mix.
    "auto": BasicPitchProfile(None, None, onset_threshold=0.44, frame_threshold=0.28, minimum_note_length_ms=62.0),
}


_MODEL: Any | None = None
_MODEL_LOCK = Lock()


def _shared_model() -> Any:
    """Load the official Basic Pitch model once per worker process.

    ``predict`` accepts an already loaded Model. The public worker processes one
    transcription at a time, so retaining this relatively small model avoids a
    full model parse on every upload without introducing concurrent inference.
    """
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            from basic_pitch import ICASSP_2022_MODEL_PATH
            from basic_pitch.inference import Model

            _MODEL = Model(ICASSP_2022_MODEL_PATH)
    return _MODEL


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


def fuse_transcription_passes(
    enhanced_events: tuple[RawNoteEvent, ...],
    reference_events: tuple[RawNoteEvent, ...],
    profile: BasicPitchProfile,
    *,
    onset_tolerance_seconds: float = 0.12,
) -> tuple[RawNoteEvent, ...]:
    """Fuse model results from clean and unmodified normalized audio.

    Agreement preserves weak real notes that survive both representations.
    Events seen in just one pass need stronger duration/confidence evidence,
    which suppresses the unstable pitch fragments common in muddy recordings.
    No pitch is inferred and octave disagreements are never silently combined.
    """

    available_reference = set(range(len(reference_events)))
    fused: list[RawNoteEvent] = []
    enhanced_singletons: list[RawNoteEvent] = []

    for enhanced in sorted(enhanced_events, key=lambda event: (event.start_seconds, event.midi_pitch)):
        candidates: list[tuple[float, int]] = []
        for index in available_reference:
            reference = reference_events[index]
            if reference.midi_pitch != enhanced.midi_pitch:
                continue
            onset_distance = abs(reference.start_seconds - enhanced.start_seconds)
            overlap = min(reference.end_seconds, enhanced.end_seconds) - max(reference.start_seconds, enhanced.start_seconds)
            shortest = min(
                reference.end_seconds - reference.start_seconds,
                enhanced.end_seconds - enhanced.start_seconds,
            )
            overlap_ratio = max(0.0, overlap) / max(shortest, 1e-9)
            if onset_distance <= onset_tolerance_seconds or overlap_ratio >= 0.55:
                candidates.append((onset_distance - 0.04 * overlap_ratio, index))
        if not candidates:
            enhanced_singletons.append(enhanced)
            continue

        _, match_index = min(candidates)
        available_reference.remove(match_index)
        reference = reference_events[match_index]
        enhanced_confidence = enhanced.confidence if enhanced.confidence is not None else 0.5
        reference_confidence = reference.confidence if reference.confidence is not None else 0.5
        total_weight = max(enhanced_confidence + reference_confidence, 1e-9)
        fused.append(RawNoteEvent(
            start_seconds=(enhanced.start_seconds * enhanced_confidence + reference.start_seconds * reference_confidence) / total_weight,
            end_seconds=(enhanced.end_seconds * enhanced_confidence + reference.end_seconds * reference_confidence) / total_weight,
            midi_pitch=enhanced.midi_pitch,
            velocity=round((enhanced.velocity * enhanced_confidence + reference.velocity * reference_confidence) / total_weight),
            confidence=min(1.0, 0.7 * max(enhanced_confidence, reference_confidence) + 0.3 * min(enhanced_confidence, reference_confidence) + 0.08),
            onset_confidence=max(value for value in (enhanced.onset_confidence, reference.onset_confidence) if value is not None) if enhanced.onset_confidence is not None or reference.onset_confidence is not None else None,
            frame_confidence=max(value for value in (enhanced.frame_confidence, reference.frame_confidence) if value is not None) if enhanced.frame_confidence is not None or reference.frame_confidence is not None else None,
            source="basic-pitch-dual-pass",
        ))

    enhanced_confidence_floor = max(0.48, profile.frame_threshold + 0.16)
    reference_confidence_floor = max(0.58, profile.onset_threshold + 0.10)
    enhanced_duration_floor = max(0.085, profile.minimum_note_length_ms / 1000 * 1.25)
    reference_duration_floor = max(0.12, profile.minimum_note_length_ms / 1000 * 1.6)

    for event in enhanced_singletons:
        confidence = event.confidence if event.confidence is not None else 0.5
        if confidence >= enhanced_confidence_floor and event.end_seconds - event.start_seconds >= enhanced_duration_floor:
            fused.append(replace(event, source="basic-pitch-enhanced-only"))
    for index in available_reference:
        event = reference_events[index]
        confidence = event.confidence if event.confidence is not None else 0.5
        if confidence >= reference_confidence_floor and event.end_seconds - event.start_seconds >= reference_duration_floor:
            fused.append(replace(event, source="basic-pitch-reference-only"))
    return tuple(sorted(fused, key=lambda event: (event.start_seconds, event.midi_pitch, event.end_seconds)))


class BasicPitchTranscriber:
    """Thin adapter; musical cleanup intentionally remains outside Basic Pitch."""

    provider = "Spotify Basic Pitch"

    def __init__(self, artifacts_directory: Path | None = None, *, retain_raw_output: bool = False) -> None:
        self.artifacts_directory = artifacts_directory
        self.retain_raw_output = retain_raw_output

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
        model_output, _, enhanced_raw_events = predict(
            str(audio.model_input_path or audio.path),
            model_or_model_path=_shared_model(),
            onset_threshold=profile.onset_threshold,
            frame_threshold=profile.frame_threshold,
            minimum_note_length=profile.minimum_note_length_ms,
            minimum_frequency=profile.minimum_frequency_hz,
            maximum_frequency=profile.maximum_frequency_hz,
            multiple_pitch_bends=profile.multiple_pitch_bends,
            melodia_trick=profile.melodia_trick,
        )
        enhanced_events = tuple(raw_event_from_basic_pitch(event, "basic-pitch-enhanced") for event in enhanced_raw_events)
        reference_events: tuple[RawNoteEvent, ...] = ()
        dual_pass_used = bool(audio.model_input_path and audio.model_input_path != audio.path)
        if dual_pass_used:
            # The frame tensors are only needed when raw diagnostics were
            # explicitly requested. Release them before the second inference on
            # memory-constrained workers; the event list and MIDI stay intact.
            if not self.retain_raw_output:
                model_output = None
            _, _, reference_raw_events = predict(
                str(audio.path),
                model_or_model_path=_shared_model(),
                onset_threshold=profile.onset_threshold,
                frame_threshold=profile.frame_threshold,
                minimum_note_length=profile.minimum_note_length_ms,
                minimum_frequency=profile.minimum_frequency_hz,
                maximum_frequency=profile.maximum_frequency_hz,
                multiple_pitch_bends=profile.multiple_pitch_bends,
                melodia_trick=profile.melodia_trick,
            )
            reference_events = tuple(raw_event_from_basic_pitch(event, "basic-pitch-reference") for event in reference_raw_events)
            selected_events = fuse_transcription_passes(enhanced_events, reference_events, profile)
        else:
            selected_events = enhanced_events
        artifact_directory = self._artifact_directory(audio.path)
        raw_output_path = artifact_directory / "basic-pitch-raw.npz" if artifact_directory and self.retain_raw_output else None
        if raw_output_path:
            self._save_raw_output(raw_output_path, model_output)
        parameters = asdict(profile)
        parameters["targetInstrument"] = target
        parameters["modelInput"] = "dual-pass-noise-reduced-plus-reference" if dual_pass_used else "source-normalized"
        parameters["enhancedEventCount"] = len(enhanced_events)
        parameters["referenceEventCount"] = len(reference_events)
        parameters["selectedEventCount"] = len(selected_events)
        parameters["processingSeconds"] = round(perf_counter() - started, 4)
        return TranscriberOutput(
            raw_events=selected_events,
            provider=self.provider,
            version=basic_pitch_version,
            parameters=parameters,
            # The pipeline exports one canonical MIDI from the fused/refined
            # event timeline. Writing Basic Pitch's intermediate MIDI here is
            # redundant and can fail on noisy overlapping events with a
            # negative delta time before the canonical exporter gets a chance.
            midi_path=None,
            raw_output_path=raw_output_path,
            warnings=(
                "Basic Pitch used dual-pass agreement between noise-reduced and normalized audio."
                if dual_pass_used else
                "Basic Pitch used the normalized source because no enhanced model input was available.",
            ),
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
