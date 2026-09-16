"""Beat/BPM analysis adapter used independently from note transcription."""
from __future__ import annotations

from .audio import NormalizedAudio
from .contracts import BeatGrid


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

