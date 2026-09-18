"""Canonical, notation-ready score contract.

MIDI and MusicXML are exports from this structure. The browser editor must edit
this graph, then regenerate those exports, rather than edit renderer SVG.
"""
from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from .contracts import BeatGrid, RawNoteEvent


MUSIC21_INSTRUMENT_NAMES: dict[str, str] = {
    "guitar": "Acoustic Guitar",
    "bass": "Electric Bass",
    "piano": "Piano",
    "vocals": "Voice",
    "drums": "Percussion",
    # These targets describe notation intent, not an instrument detected in the
    # signal. Piano is only used as a neutral playback voice for their exports.
    "chords": "Piano",
    "lead-sheet": "Piano",
}


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
        has_pulse = bool(beat_grid.beats_seconds or beat_grid.bpm)
        beats_per_measure = None
        if beat_grid.time_signature:
            beats_per_measure = beat_grid.time_signature[0] * 4 / beat_grid.time_signature[1]
        measures: dict[int, list[QuantizedNote]] = {}
        for event_index, event in enumerate(events):
            if has_pulse:
                # A detected beat grid can legitimately begin after the first
                # audible note (pickup/anacrusis). MusicXML can represent that
                # offset, but a negative stream offset becomes an invalid MIDI
                # delta. Anchor pre-grid notes at zero while retaining duration.
                raw_start = self._seconds_to_beats(event.start_seconds, beat_grid)
                raw_end = self._seconds_to_beats(event.end_seconds, beat_grid)
                start = max(Fraction(0), self._round_to_grid(raw_start))
                end = max(start, self._round_to_grid(raw_end))
                duration = max(Fraction(1, self.subdivisions_per_beat), end - start)
            else:
                # Preserve relative model timing without inventing a tempo. In
                # free rhythm, one internal quarterLength represents one second;
                # no metronome mark is exported, so this is not a BPM claim.
                # Snap to the configured notation grid because arbitrary
                # millisecond fractions cannot always be expressed in MusicXML.
                start = self._round_to_grid(event.start_seconds)
                end = self._round_to_grid(event.end_seconds)
                duration = max(Fraction(1, self.subdivisions_per_beat), end - start)
            measure_index = int(float(start) // beats_per_measure) + 1 if beats_per_measure else 1
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
            warnings=((
                "Detected note timing was aligned to the measured pulse grid; review syncopation and tuplets."
                if has_pulse
                else "No reliable pulse was detected; source note timing is exported in free rhythm without a tempo or meter claim."
            ),),
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
        instrument_name = MUSIC21_INSTRUMENT_NAMES.get(score.target_instrument)
        if instrument_name:
            part.insert(0, instrument.fromString(instrument_name))
        else:
            # "auto" means no instrument was established by evidence. A plain
            # Instrument keeps the score exportable without asserting a label.
            generic_instrument = instrument.Instrument()
            generic_instrument.partName = "Transcription"
            part.insert(0, generic_instrument)
        if score.beat_grid.time_signature:
            numerator, denominator = score.beat_grid.time_signature
            part.insert(0, meter.TimeSignature(f"{numerator}/{denominator}"))
            notation_stream = part
        else:
            # Put senza-misura directly in the first measure. A time signature
            # attached only to Part makes music21 prepend its implicit 4/4
            # before the free-meter declaration during MusicXML export.
            free_measure = stream.Measure(number=1)
            free_measure.insert(0, meter.SenzaMisuraTimeSignature("free"))
            notation_stream = free_measure
        if score.beat_grid.bpm:
            part.insert(0, tempo.MetronomeMark(number=score.beat_grid.bpm))
        for measure in score.measures:
            for quantized in measure.notes:
                rendered_note = note.Note(quantized.pitch)
                rendered_note.quarterLength = float(quantized.duration_beats)
                notation_stream.insert(float(quantized.start_beat), rendered_note)
        if notation_stream is not part:
            part.append(notation_stream)
        rendered.insert(0, part)
        midi_path = output_directory / "canonical-score.mid"
        musicxml_path = output_directory / "canonical-score.musicxml"
        rendered.write("midi", fp=str(midi_path))
        rendered.write("musicxml", fp=str(musicxml_path))
        return ScoreExports(midi_path=midi_path, musicxml_path=musicxml_path)
