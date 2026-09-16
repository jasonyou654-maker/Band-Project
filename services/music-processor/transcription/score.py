"""Canonical, notation-ready score contract.

MIDI and MusicXML are exports from this structure. The browser editor must edit
this graph, then regenerate those exports, rather than edit renderer SVG.
"""
from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from .contracts import BeatGrid, RawNoteEvent


@dataclass(frozen=True)
class QuantizedNote:
    pitch: int
    start_beat: Fraction
    duration_beats: Fraction
    note_id: str = ""
    voice: int = 1
    staff: int = 1
    source_event: RawNoteEvent | None = None
    confidence: float | None = None


@dataclass(frozen=True)
class ScoreMeasure:
    index: int
    notes: tuple[QuantizedNote, ...]


@dataclass(frozen=True)
class CanonicalScore:
    title: str
    target_instrument: str
    beat_grid: BeatGrid
    measures: tuple[ScoreMeasure, ...]
    key_signature: str | None = None
    warnings: tuple[str, ...] = ()
    revision: int = 1


class RhythmQuantizer:
    """Interface reserved for beat-aware dynamic-programming quantization."""

    def quantize(self, events: tuple[RawNoteEvent, ...], beat_grid: BeatGrid, title: str, target_instrument: str) -> CanonicalScore:
        raise NotImplementedError("A beat-aware quantizer is not implemented until benchmark clips establish acceptable error trade-offs.")


class GridRhythmQuantizer(RhythmQuantizer):
    """Conservative grid quantizer for explicitly requested strict notation."""

    def __init__(self, subdivisions_per_beat: int = 4) -> None:
        if subdivisions_per_beat not in {1, 2, 3, 4, 6, 8}:
            raise ValueError("Unsupported subdivision grid.")
        self.subdivisions_per_beat = subdivisions_per_beat

    def quantize(self, events: tuple[RawNoteEvent, ...], beat_grid: BeatGrid, title: str, target_instrument: str) -> CanonicalScore:
        if not beat_grid.beats_seconds and beat_grid.bpm is None:
            raise ValueError("Quantization requires beat times or BPM.")
        beats_per_measure = (beat_grid.time_signature or (4, 4))[0] * 4 / (beat_grid.time_signature or (4, 4))[1]
        measures: dict[int, list[QuantizedNote]] = {}
        for event_index, event in enumerate(events):
            start = self._round_to_grid(self._seconds_to_beats(event.start_seconds, beat_grid))
            end = self._round_to_grid(self._seconds_to_beats(event.end_seconds, beat_grid))
            duration = max(Fraction(1, self.subdivisions_per_beat), end - start)
            measure_index = int(float(start) // beats_per_measure) + 1
            measures.setdefault(measure_index, []).append(
                QuantizedNote(
                    pitch=event.midi_pitch,
                    start_beat=start,
                    duration_beats=duration,
                    note_id=f"note-{event_index}",
                    source_event=event,
                    confidence=event.confidence,
                )
            )
        return CanonicalScore(
            title=title,
            target_instrument=target_instrument,
            beat_grid=beat_grid,
            measures=tuple(
                ScoreMeasure(index=index, notes=tuple(sorted(notes, key=lambda note: (note.start_beat, note.pitch))))
                for index, notes in sorted(measures.items())
            ),
            warnings=("Strict rhythm quantization was explicitly requested; review syncopation and tuplets.",),
        )

    def _round_to_grid(self, beats: float) -> Fraction:
        return Fraction(round(beats * self.subdivisions_per_beat), self.subdivisions_per_beat)

    @staticmethod
    def _seconds_to_beats(seconds: float, beat_grid: BeatGrid) -> float:
        beats = beat_grid.beats_seconds
        if len(beats) >= 2:
            if seconds <= beats[0]:
                interval = beats[1] - beats[0]
                return (seconds - beats[0]) / interval
            for index, (left, right) in enumerate(zip(beats, beats[1:])):
                if left <= seconds <= right:
                    return index + (seconds - left) / (right - left)
            interval = beats[-1] - beats[-2]
            return len(beats) - 1 + (seconds - beats[-1]) / interval
        if beat_grid.bpm:
            return seconds * beat_grid.bpm / 60
        raise ValueError("Quantization requires beat times or BPM.")


@dataclass(frozen=True)
class ScoreExports:
    midi_path: Path
    musicxml_path: Path


class Music21ScoreExporter:
    """Derive interoperable MIDI and MusicXML from a canonical score graph."""

    def export(self, score: CanonicalScore, output_directory: Path) -> ScoreExports:
        try:
            from music21 import instrument, metadata, meter, note, stream, tempo
        except ImportError as error:
            raise RuntimeError("music21 is not installed in the processing service.") from error
        output_directory.mkdir(parents=True, exist_ok=True)
        rendered = stream.Score()
        rendered.metadata = metadata.Metadata(title=score.title)
        part = stream.Part()
        part.insert(0, instrument.fromString(score.target_instrument.title()))
        numerator, denominator = score.beat_grid.time_signature or (4, 4)
        part.insert(0, meter.TimeSignature(f"{numerator}/{denominator}"))
        if score.beat_grid.bpm:
            part.insert(0, tempo.MetronomeMark(number=score.beat_grid.bpm))
        for measure in score.measures:
            for quantized in measure.notes:
                rendered_note = note.Note(quantized.pitch)
                rendered_note.quarterLength = float(quantized.duration_beats)
                part.insert(float(quantized.start_beat), rendered_note)
        rendered.insert(0, part)
        midi_path = output_directory / "canonical-score.mid"
        musicxml_path = output_directory / "canonical-score.musicxml"
        rendered.write("midi", fp=str(midi_path))
        rendered.write("musicxml", fp=str(musicxml_path))
        return ScoreExports(midi_path=midi_path, musicxml_path=musicxml_path)
