"""Low-memory, evidence-gated beat and meter analysis."""
from __future__ import annotations

import audioop
import math
import statistics
import wave
from dataclasses import dataclass
from typing import Iterable

from .audio import NormalizedAudio
from .contracts import BeatGrid, RawNoteEvent


@dataclass(frozen=True)
class _Onset:
    seconds: float
    weight: float


class EnergyBeatTracker:
    """Fuse waveform attacks with transcribed note onsets.

    Muddy mixes often hide attacks in RMS energy while still producing stable
    Basic Pitch note boundaries. Conversely, percussive audio may expose a
    strong waveform pulse without pitched notes. A tempo is published only
    when the combined evidence is sufficiently periodic.
    """

    provider = "hybrid waveform + note-onset beat tracker"
    frames_per_second = 80
    minimum_bpm = 45
    maximum_bpm = 210

    def track(self, audio: NormalizedAudio) -> BeatGrid:
        return self.track_with_events(audio, ())

    def track_with_events(self, audio: NormalizedAudio, events: Iterable[RawNoteEvent]) -> BeatGrid:
        envelope = self._onset_envelope(audio)
        if len(envelope) < self.frames_per_second * 3:
            return BeatGrid()
        audio_onsets = self._peak_onsets(envelope)
        note_onsets = self._note_onsets(events)
        onsets = self._merge_evidence(audio_onsets, note_onsets)
        if len(onsets) < 6:
            return BeatGrid()

        candidates = self._tempo_candidates(envelope, onsets)
        if not candidates:
            return BeatGrid()
        candidates.sort(reverse=True)
        best_score, bpm, phase, components = candidates[0]
        unrelated = [candidate for candidate in candidates[1:] if not self._related_tempo(bpm, candidate[1])]
        runner_score = unrelated[0][0] if unrelated else 0.0
        margin = max(0.0, (best_score - runner_score) / max(best_score, 1e-9))
        evidence_quality = min(1.0, len(onsets) / 28.0)
        agreement = min(components)
        confidence = max(0.0, min(1.0, 0.48 * best_score + 0.22 * margin + 0.18 * agreement + 0.12 * evidence_quality))
        if confidence < 0.38 or best_score < 0.34:
            return BeatGrid(confidence=confidence)

        duration = max(len(envelope) / self.frames_per_second, audio.duration_seconds)
        period = 60.0 / bpm
        first = phase
        while first - period >= 0:
            first -= period
        while first < 0:
            first += period
        beats = tuple(first + index * period for index in range(max(0, int((duration - first) / period) + 1)))
        meter = self._estimate_meter(envelope, onsets, beats)
        return BeatGrid(bpm=round(bpm, 2), beats_seconds=beats, time_signature=meter, confidence=confidence)

    def _onset_envelope(self, audio: NormalizedAudio) -> list[float]:
        with wave.open(str(audio.path), "rb") as source:
            channels = source.getnchannels()
            width = source.getsampwidth()
            sample_rate = source.getframerate()
            frames_per_window = max(1, sample_rate // self.frames_per_second)
            maximum_frames = min(source.getnframes(), sample_rate * 180)
            energies: list[float] = []
            read_frames = 0
            while read_frames < maximum_frames:
                count = min(frames_per_window, maximum_frames - read_frames)
                raw = source.readframes(count)
                if not raw:
                    break
                if channels == 2:
                    raw = audioop.tomono(raw, width, 0.5, 0.5)
                energies.append(math.log1p(float(audioop.rms(raw, width))))
                read_frames += count
        if len(energies) < 3:
            return []
        flux = [0.0]
        flux.extend(max(0.0, current - previous) for previous, current in zip(energies, energies[1:]))
        radius = max(2, self.frames_per_second // 4)
        prefix = [0.0]
        for value in flux:
            prefix.append(prefix[-1] + value)
        adaptive: list[float] = []
        for index, value in enumerate(flux):
            left = max(0, index - radius)
            right = min(len(flux), index + radius + 1)
            local_mean = (prefix[right] - prefix[left]) / max(1, right - left)
            adaptive.append(max(0.0, value - local_mean * 0.65))
        peak = max(adaptive, default=0.0)
        return [value / peak for value in adaptive] if peak > 1e-9 else [0.0] * len(adaptive)

    def _peak_onsets(self, envelope: list[float]) -> list[_Onset]:
        positive = [value for value in envelope if value > 0]
        if not positive:
            return []
        threshold = max(0.10, statistics.fmean(positive) + statistics.pstdev(positive) * 0.35)
        refractory = max(1, round(self.frames_per_second * 0.075))
        peaks: list[_Onset] = []
        for index in range(1, len(envelope) - 1):
            value = envelope[index]
            if value < threshold or value < envelope[index - 1] or value < envelope[index + 1]:
                continue
            onset = _Onset(index / self.frames_per_second, 0.35 + 0.65 * value)
            if peaks and index / self.frames_per_second - peaks[-1].seconds < refractory / self.frames_per_second:
                if onset.weight > peaks[-1].weight:
                    peaks[-1] = onset
            else:
                peaks.append(onset)
        return peaks

    @staticmethod
    def _note_onsets(events: Iterable[RawNoteEvent]) -> list[_Onset]:
        raw = sorted(
            (_Onset(event.start_seconds, (event.confidence if event.confidence is not None else 0.5) * (0.45 + 0.55 * event.velocity / 127)) for event in events),
            key=lambda onset: onset.seconds,
        )
        collapsed: list[_Onset] = []
        for onset in raw:
            if collapsed and onset.seconds - collapsed[-1].seconds <= 0.055:
                previous = collapsed[-1]
                total = previous.weight + onset.weight
                collapsed[-1] = _Onset((previous.seconds * previous.weight + onset.seconds * onset.weight) / total, min(1.0, total))
            else:
                collapsed.append(onset)
        return collapsed

    @staticmethod
    def _merge_evidence(audio_onsets: list[_Onset], note_onsets: list[_Onset]) -> list[_Onset]:
        merged: list[_Onset] = []
        tagged = [(onset.seconds, onset.weight * 0.78) for onset in audio_onsets]
        tagged.extend((onset.seconds, onset.weight) for onset in note_onsets)
        for seconds, weight in sorted(tagged):
            onset = _Onset(seconds, weight)
            if merged and seconds - merged[-1].seconds <= 0.045:
                previous = merged[-1]
                total = previous.weight + onset.weight
                merged[-1] = _Onset((previous.seconds * previous.weight + seconds * weight) / total, min(1.5, total))
            else:
                merged.append(onset)
        return merged

    def _tempo_candidates(self, envelope: list[float], onsets: list[_Onset]) -> list[tuple[float, float, float, tuple[float, float, float]]]:
        histogram = self._interval_histogram(onsets)
        histogram_peak = max(histogram.values(), default=0.0)
        candidates = []
        for bpm in range(self.minimum_bpm, self.maximum_bpm + 1):
            period = 60.0 / bpm
            autocorrelation = self._autocorrelation(envelope, period)
            interval_score = histogram.get(bpm, 0.0) / histogram_peak if histogram_peak > 0 else 0.0
            alignment, phase = self._best_phase_alignment(onsets, period)
            score = 0.40 * autocorrelation + 0.35 * interval_score + 0.25 * alignment
            if 68 <= bpm <= 165:
                score *= 1.035
            candidates.append((min(1.0, score), float(bpm), phase, (autocorrelation, interval_score, alignment)))
        return candidates

    def _interval_histogram(self, onsets: list[_Onset]) -> dict[int, float]:
        histogram = {bpm: 0.0 for bpm in range(self.minimum_bpm, self.maximum_bpm + 1)}
        for index, left in enumerate(onsets):
            for right in onsets[index + 1:index + 17]:
                interval = right.seconds - left.seconds
                if interval > 4.0:
                    break
                if interval < 0.12:
                    continue
                pair_weight = math.sqrt(left.weight * right.weight) / (1.0 + interval * 0.18)
                for beat_multiple, multiplier_weight in ((0.5, 0.72), (1.0, 1.0), (2.0, 0.82), (3.0, 0.42), (4.0, 0.34)):
                    bpm = 60.0 * beat_multiple / interval
                    if self.minimum_bpm <= bpm <= self.maximum_bpm:
                        center = round(bpm)
                        for offset, smoothing in ((-1, 0.35), (0, 1.0), (1, 0.35)):
                            candidate = center + offset
                            if candidate in histogram:
                                histogram[candidate] += pair_weight * multiplier_weight * smoothing
        return histogram

    def _autocorrelation(self, envelope: list[float], period: float) -> float:
        lag = max(1, round(period * self.frames_per_second))
        if lag >= len(envelope):
            return 0.0
        products = sum(envelope[index] * envelope[index - lag] for index in range(lag, len(envelope)))
        left_energy = sum(value * value for value in envelope[lag:])
        right_energy = sum(value * value for value in envelope[:-lag])
        base = products / math.sqrt(left_energy * right_energy) if left_energy > 0 and right_energy > 0 else 0.0
        # A half-period echo is useful for recordings with strong eighth-note
        # detail, but it must not dominate the full-beat recurrence.
        half_lag = max(1, lag // 2)
        half_products = sum(envelope[index] * envelope[index - half_lag] for index in range(half_lag, len(envelope)))
        half_left = sum(value * value for value in envelope[half_lag:])
        half_right = sum(value * value for value in envelope[:-half_lag])
        half = half_products / math.sqrt(half_left * half_right) if half_left > 0 and half_right > 0 else 0.0
        return max(0.0, min(1.0, 0.82 * base + 0.18 * half))

    @staticmethod
    def _best_phase_alignment(onsets: list[_Onset], period: float) -> tuple[float, float]:
        strongest = sorted(onsets, key=lambda onset: onset.weight, reverse=True)[:24]
        total_weight = sum(onset.weight for onset in onsets)
        best_score, best_phase = 0.0, strongest[0].seconds % period
        for anchor in strongest:
            phase = anchor.seconds % period
            score = 0.0
            for onset in onsets:
                remainder = (onset.seconds - phase) % period
                distance = min(remainder, period - remainder)
                score += onset.weight * math.exp(-0.5 * (distance / max(period * 0.14, 0.035)) ** 2)
            normalized = score / max(total_weight, 1e-9)
            if normalized > best_score:
                best_score, best_phase = normalized, phase
        return min(1.0, best_score), best_phase

    def _estimate_meter(self, envelope: list[float], onsets: list[_Onset], beats: tuple[float, ...]) -> tuple[int, int] | None:
        if len(beats) < 12:
            return None
        accents = []
        for beat in beats:
            frame = min(len(envelope) - 1, max(0, round(beat * self.frames_per_second)))
            audio_accent = max(envelope[max(0, frame - 2):min(len(envelope), frame + 3)], default=0.0)
            note_accent = sum(onset.weight for onset in onsets if abs(onset.seconds - beat) <= 0.075)
            accents.append(audio_accent + min(1.5, note_accent) * 0.55)
        mean = statistics.fmean(accents)
        if mean <= 1e-9:
            return None
        scored: list[tuple[float, int]] = []
        for meter in (3, 4):
            best = 0.0
            for offset in range(meter):
                down = [value for index, value in enumerate(accents) if (index - offset) % meter == 0]
                other = [value for index, value in enumerate(accents) if (index - offset) % meter != 0]
                if len(down) < 3 or not other:
                    continue
                contrast = (statistics.fmean(down) - statistics.fmean(other)) / mean
                best = max(best, contrast)
            scored.append((best, meter))
        scored.sort(reverse=True)
        best, runner = scored[0], scored[1]
        if best[0] < 0.24 or best[0] - runner[0] < 0.08:
            return None
        return (best[1], 4)

    @staticmethod
    def _related_tempo(left: float, right: float) -> bool:
        if abs(left - right) <= 4:
            return True
        ratio = max(left, right) / min(left, right)
        return abs(ratio - 2.0) <= 0.08 or abs(ratio - 1.5) <= 0.05


class LibrosaBeatTracker:
    provider = "librosa beat_track"

    def track(self, audio: NormalizedAudio) -> BeatGrid:
        try:
            import librosa
            import numpy as np
        except ImportError as error:
            raise RuntimeError("librosa is not installed in the processing service.") from error
        signal, sample_rate = librosa.load(str(audio.path), sr=audio.sample_rate_hz, mono=True)
        tempo, frames = librosa.beat.beat_track(y=signal, sr=sample_rate, trim=False)
        beats = tuple(float(value) for value in librosa.frames_to_time(frames, sr=sample_rate))
        bpm = float(np.asarray(tempo).reshape(-1)[0]) if np.asarray(tempo).size else None
        return BeatGrid(bpm=bpm if bpm and bpm > 0 else None, beats_seconds=beats)
