"""Conservative event cleanup before rhythm quantization.

Rules only modify low-level timing artefacts. They deliberately do not invent
notes from harmony or force pitches into a key; those need evidence and a
reviewed benchmark before being enabled.
"""
from __future__ import annotations

from dataclasses import dataclass

from .contracts import RawNoteEvent


@dataclass(frozen=True)
class RefinementPolicy:
    minimum_duration_seconds: float = 0.045
    minimum_confidence: float = 0.12
    merge_same_pitch_gap_seconds: float = 0.035
    preserve_short_strong_onsets: bool = True


@dataclass(frozen=True)
class RefinementReport:
    input_events: int
    filtered_short_events: int
    merged_events: int


def refine_events(events: tuple[RawNoteEvent, ...], policy: RefinementPolicy = RefinementPolicy()) -> tuple[tuple[RawNoteEvent, ...], RefinementReport]:
    ordered = sorted(events, key=lambda event: (event.start_seconds, event.midi_pitch, event.end_seconds))
    filtered: list[RawNoteEvent] = []
    filtered_short = 0
    for event in ordered:
        is_short = event.end_seconds - event.start_seconds < policy.minimum_duration_seconds
        strong_onset = (event.onset_confidence or 0) >= policy.minimum_confidence
        weak_event = (event.confidence or 1) < policy.minimum_confidence
        if is_short and weak_event and not (policy.preserve_short_strong_onsets and strong_onset):
            filtered_short += 1
            continue
        filtered.append(event)

    merged: list[RawNoteEvent] = []
    merged_count = 0
    for event in filtered:
        if merged:
            previous = merged[-1]
            gap = event.start_seconds - previous.end_seconds
            no_retrigger_evidence = event.onset_confidence is None or event.onset_confidence < policy.minimum_confidence
            if event.midi_pitch == previous.midi_pitch and 0 <= gap <= policy.merge_same_pitch_gap_seconds and no_retrigger_evidence:
                merged[-1] = RawNoteEvent(
                    start_seconds=previous.start_seconds,
                    end_seconds=event.end_seconds,
                    midi_pitch=previous.midi_pitch,
                    velocity=max(previous.velocity, event.velocity),
                    confidence=max(value for value in (previous.confidence, event.confidence) if value is not None) if previous.confidence is not None or event.confidence is not None else None,
                    onset_confidence=previous.onset_confidence,
                    frame_confidence=event.frame_confidence or previous.frame_confidence,
                    source=f"{previous.source}+merged",
                    inferred=previous.inferred or event.inferred,
                )
                merged_count += 1
                continue
        merged.append(event)
    return tuple(merged), RefinementReport(len(events), filtered_short, merged_count)

