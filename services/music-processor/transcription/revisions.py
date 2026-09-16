"""Auditable canonical-score corrections for review and future model training."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from fractions import Fraction
from typing import Literal

from .score import CanonicalScore, QuantizedNote, ScoreMeasure


EditKind = Literal["add", "delete", "update"]


@dataclass(frozen=True)
class ScoreEditOperation:
    operation_id: str
    kind: EditKind
    note_id: str
    pitch: int | None = None
    start_beat: float | None = None
    duration_beats: float | None = None
    actor: Literal["user", "system"] = "user"
    created_at: str = ""

    def __post_init__(self) -> None:
        if self.kind == "add" and (self.pitch is None or self.start_beat is None or self.duration_beats is None):
            raise ValueError("Added notes require pitch, start_beat, and duration_beats.")
        if self.pitch is not None and not 0 <= self.pitch <= 127:
            raise ValueError("Edited pitch must be a MIDI value in [0, 127].")
        if self.duration_beats is not None and self.duration_beats <= 0:
            raise ValueError("Edited duration must be positive.")


@dataclass(frozen=True)
class ScoreRevision:
    score: CanonicalScore
    operations: tuple[ScoreEditOperation, ...]
    created_at: str


def apply_score_operations(score: CanonicalScore, operations: tuple[ScoreEditOperation, ...]) -> ScoreRevision:
    """Apply immutable edits; every user change remains replayable and auditable."""
    notes = {note.note_id: note for measure in score.measures for note in measure.notes}
    for operation in operations:
        if operation.kind == "delete":
            if operation.note_id not in notes:
                raise ValueError(f"Cannot delete unknown note: {operation.note_id}")
            del notes[operation.note_id]
        elif operation.kind == "update":
            existing = notes.get(operation.note_id)
            if existing is None:
                raise ValueError(f"Cannot update unknown note: {operation.note_id}")
            notes[operation.note_id] = replace(
                existing,
                pitch=operation.pitch if operation.pitch is not None else existing.pitch,
                start_beat=_fraction(operation.start_beat) if operation.start_beat is not None else existing.start_beat,
                duration_beats=_fraction(operation.duration_beats) if operation.duration_beats is not None else existing.duration_beats,
            )
        else:
            if operation.note_id in notes:
                raise ValueError(f"Cannot add a duplicate note id: {operation.note_id}")
            notes[operation.note_id] = QuantizedNote(
                note_id=operation.note_id,
                pitch=operation.pitch or 0,
                start_beat=_fraction(operation.start_beat),
                duration_beats=_fraction(operation.duration_beats),
                confidence=None,
            )
    beats_per_measure = _beats_per_measure(score)
    grouped: dict[int, list[QuantizedNote]] = {}
    for note in notes.values():
        measure_index = int(float(note.start_beat) // beats_per_measure) + 1
        grouped.setdefault(measure_index, []).append(note)
    revised = replace(
        score,
        measures=tuple(
            ScoreMeasure(index=index, notes=tuple(sorted(items, key=lambda item: (item.start_beat, item.pitch, item.note_id))))
            for index, items in sorted(grouped.items())
        ),
        revision=score.revision + 1,
    )
    normalized_operations = tuple(
        replace(operation, created_at=operation.created_at or datetime.now(timezone.utc).isoformat())
        for operation in operations
    )
    return ScoreRevision(score=revised, operations=normalized_operations, created_at=datetime.now(timezone.utc).isoformat())


def correction_training_record(score_id: str, revision: ScoreRevision, pipeline_version: str, consented: bool) -> dict:
    """Portable opt-in-only record; audio is referenced, never embedded here."""
    return {
        "schemaVersion": 1,
        "scoreId": score_id,
        "pipelineVersion": pipeline_version,
        "consentedForTraining": consented,
        "revision": revision.score.revision,
        "operations": [
            {
                "operationId": operation.operation_id,
                "kind": operation.kind,
                "noteId": operation.note_id,
                "pitch": operation.pitch,
                "startBeat": operation.start_beat,
                "durationBeats": operation.duration_beats,
                "actor": operation.actor,
                "createdAt": operation.created_at,
            }
            for operation in revision.operations
        ],
    }


def _fraction(value: float | None) -> Fraction:
    if value is None:
        raise ValueError("A beat value is required.")
    return Fraction(str(value)).limit_denominator(48)


def _beats_per_measure(score: CanonicalScore) -> float:
    numerator, denominator = score.beat_grid.time_signature or (4, 4)
    return numerator * 4 / denominator

