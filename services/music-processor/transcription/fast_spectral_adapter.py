"""Low-latency note tracking for the public CPU worker."""
from __future__ import annotations

from math import gcd, log2
from pathlib import Path
from time import perf_counter

from .adapters import TranscriberOutput
from .audio import NormalizedAudio
from .contracts import RawNoteEvent, TargetInstrument


RANGES = {
    "bass": (30.0, 600.0),
    "guitar": (65.0, 1400.0),
    "piano": (27.5, 4200.0),
    "vocals": (60.0, 1200.0),
    "drums": (35.0, 4000.0),
    "chords": (45.0, 2500.0),
    "lead-sheet": (60.0, 1400.0),
    "auto": (27.5, 4200.0),
}
POLYPHONY = {"piano": 4, "chords": 4, "guitar": 3, "auto": 3, "drums": 2}


class FastSpectralTranscriber:
    provider = "BandProject Fast Spectral Notes"

    @classmethod
    def warm(cls) -> None:
        """Load heavy audio dependencies and prime FFT kernels before traffic."""
        import numpy
        import soundfile  # noqa: F401
        from scipy.signal import resample_poly

        silence = numpy.zeros(4096, dtype="float32")
        resample_poly(silence, 1, 2)
        cls._track(numpy, silence, 16000, "bass")

    def transcribe(self, audio: NormalizedAudio, target: TargetInstrument) -> TranscriberOutput:
        try:
            import numpy
            import soundfile
            from scipy.signal import resample_poly
        except ImportError as error:
            raise RuntimeError("Fast spectral transcription requires numpy, scipy, and soundfile.") from error
        started = perf_counter()
        source = audio.model_input_path or audio.path
        samples, source_rate = soundfile.read(source, dtype="float32", always_2d=True)
        waveform = samples.mean(axis=1)
        sample_rate = 16000
        if source_rate != sample_rate:
            divisor = gcd(source_rate, sample_rate)
            waveform = resample_poly(waveform, sample_rate // divisor, source_rate // divisor).astype("float32")
        events = self._track(numpy, waveform, sample_rate, target)
        return TranscriberOutput(
            raw_events=events,
            provider=self.provider,
            version="1",
            parameters={
                "targetInstrument": target,
                "frameSize": 2048,
                "hopLength": 512,
                "processingSeconds": round(perf_counter() - started, 4),
                "selectedEventCount": len(events),
                "mode": "single-pass-low-latency",
            },
            warnings=("Fast spectral mode favors latency; use TRANSCRIPTION_ENGINE=basic-pitch for maximum polyphonic accuracy.",),
        )

    @staticmethod
    def _track(numpy, waveform, sample_rate: int, target: TargetInstrument) -> tuple[RawNoteEvent, ...]:
        frame_size, hop = 2048, 512
        if waveform.shape[0] < frame_size:
            waveform = numpy.pad(waveform, (0, frame_size - waveform.shape[0]))
        frames = numpy.lib.stride_tricks.sliding_window_view(waveform, frame_size)[::hop]
        window = numpy.hanning(frame_size + 1)[:-1].astype("float32")
        frequencies = numpy.fft.rfftfreq(frame_size, 1 / sample_rate)
        low, high = RANGES[target]
        band = numpy.flatnonzero((frequencies >= low) & (frequencies <= high))
        max_notes = POLYPHONY.get(target, 1)
        frame_notes: list[dict[int, float]] = []
        for offset in range(0, frames.shape[0], 256):
            block = numpy.asarray(frames[offset:offset + 256]) * window
            magnitudes = numpy.abs(numpy.fft.rfft(block, axis=1))[:, band]
            rms = numpy.sqrt(numpy.mean(block * block, axis=1))
            energy_floor = max(1e-5, float(numpy.percentile(rms, 20)) * 1.8)
            for row, energy in zip(magnitudes, rms):
                if energy < energy_floor or not numpy.any(row):
                    frame_notes.append({})
                    continue
                candidate_count = min(row.shape[0], max_notes * 6)
                candidates = numpy.argpartition(row, -candidate_count)[-candidate_count:]
                peak = float(row[candidates].max())
                accepted = []
                for local_index in candidates:
                    if row[local_index] < peak * 0.16:
                        continue
                    if 0 < local_index < row.shape[0] - 1 and row[local_index] < max(row[local_index - 1], row[local_index + 1]):
                        continue
                    frequency = float(frequencies[band[local_index]])
                    midi = max(0, min(127, round(69 + 12 * log2(frequency / 440.0))))
                    accepted.append((frequency, midi, float(row[local_index] / max(peak, 1e-9))))
                if target == "bass":
                    accepted.sort(key=lambda item: item[0])
                else:
                    accepted.sort(key=lambda item: item[2], reverse=True)
                notes = {}
                for _, midi, confidence in accepted:
                    notes[midi] = max(notes.get(midi, 0.0), confidence)
                    if len(notes) >= max_notes:
                        break
                frame_notes.append(notes)
        return FastSpectralTranscriber._merge_frames(frame_notes, hop / sample_rate)

    @staticmethod
    def _merge_frames(frame_notes: list[dict[int, float]], frame_seconds: float) -> tuple[RawNoteEvent, ...]:
        active: dict[int, dict[str, float]] = {}
        events = []
        for index, notes in enumerate(frame_notes):
            for midi, confidence in notes.items():
                state = active.setdefault(midi, {"start": float(index), "last": float(index), "confidence": 0.0, "frames": 0.0})
                state["last"] = float(index)
                state["confidence"] += confidence
                state["frames"] += 1
            for midi, state in list(active.items()):
                if midi not in notes and index - state["last"] > 1:
                    FastSpectralTranscriber._finish(events, midi, state, frame_seconds)
                    del active[midi]
        for midi, state in active.items():
            FastSpectralTranscriber._finish(events, midi, state, frame_seconds)
        return tuple(sorted(events, key=lambda event: (event.start_seconds, event.midi_pitch)))

    @staticmethod
    def _finish(events: list[RawNoteEvent], midi: int, state: dict[str, float], frame_seconds: float) -> None:
        duration_frames = state["last"] - state["start"] + 1
        if duration_frames < 2:
            return
        confidence = min(1.0, state["confidence"] / max(1.0, state["frames"]))
        events.append(RawNoteEvent(
            start_seconds=state["start"] * frame_seconds,
            end_seconds=(state["last"] + 1) * frame_seconds,
            midi_pitch=midi,
            velocity=max(1, min(127, round(45 + 82 * confidence))),
            confidence=confidence,
            onset_confidence=confidence,
            frame_confidence=confidence,
            source="fast-spectral",
        ))
