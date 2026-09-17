"""Beat/BPM analysis adapter used independently from note transcription."""
from __future__ import annotations

import audioop
import wave

from .audio import NormalizedAudio
from .contracts import BeatGrid


class EnergyBeatTracker:
    """Low-memory onset-energy beat tracker for constrained workers.

    It returns no BPM when the waveform contains too little pulse evidence,
    rather than forcing a value into a preferred range.
    """

    provider = "server onset-energy autocorrelation"

    def track(self, audio: NormalizedAudio) -> BeatGrid:
        with wave.open(str(audio.path), "rb") as source:
            channels = source.getnchannels()
            width = source.getsampwidth()
            sample_rate = source.getframerate()
            frames_per_window = max(1, sample_rate // 40)
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
                energies.append(float(audioop.rms(raw, width)))
                read_frames += count
        if len(energies) < 120:
            return BeatGrid()
        flux = [max(0.0, current - previous) for previous, current in zip(energies, energies[1:])]
        peak = max(flux, default=0.0)
        if peak <= 1.0:
            return BeatGrid()
        envelope = [value / peak for value in flux]
        mean = sum(envelope) / len(envelope)
        envelope = [value - mean for value in envelope]
        candidates: list[tuple[float, float]] = []
        for bpm in range(55, 201):
            lag = max(1, round(40 * 60 / bpm))
            if lag >= len(envelope):
                continue
            score = sum(envelope[index] * envelope[index - lag] for index in range(lag, len(envelope))) / (len(envelope) - lag)
            # Mildly prefer the central human-tempo range when octave-related
            # candidates contain essentially the same evidence.
            prior = 1.0 if 70 <= bpm <= 160 else 0.97
            candidates.append((score * prior, float(bpm)))
        candidates.sort(reverse=True)
        if not candidates or candidates[0][0] <= 1e-6:
            return BeatGrid()
        best_score, bpm = candidates[0]
        runner_up = next((score for score, other in candidates if abs(other - bpm) > 3), 0.0)
        confidence = max(0.0, min(1.0, (best_score - runner_up) / max(abs(best_score), 1e-9)))
        if confidence < 0.05:
            return BeatGrid(confidence=confidence)
        return BeatGrid(bpm=bpm, confidence=confidence)


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
