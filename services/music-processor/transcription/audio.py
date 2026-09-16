"""Audio preparation contracts; implementations can use ffmpeg, not the browser."""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Callable, Protocol

from .contracts import AudioAsset, TranscriptionRequest


@dataclass(frozen=True)
class NormalizedAudio:
    path: Path
    duration_seconds: float
    sample_rate_hz: int
    channels: int
    loudness_lufs: float | None = None
    clipped: bool = False


class AudioPreprocessor(Protocol):
    """Decode, validate, normalize loudness, and create model-ready PCM files."""

    def normalize(self, request: TranscriptionRequest, source_path: Path) -> NormalizedAudio: ...


class PassthroughAudioPreprocessor:
    """Temporary local implementation for callers already supplying normalized WAV."""

    def normalize(self, request: TranscriptionRequest, source_path: Path) -> NormalizedAudio:
        audio: AudioAsset = request.audio
        return NormalizedAudio(
            path=source_path,
            duration_seconds=audio.duration_seconds or 0.0,
            sample_rate_hz=audio.sample_rate_hz or 22050,
            channels=audio.channels or 1,
        )


class FfmpegAudioPreprocessor:
    """Create a deterministic, lossless WAV while preserving separation cues."""

    def __init__(self, output_directory: Path, command_runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
        self.output_directory = output_directory
        self.command_runner = command_runner
        self.ffmpeg_command = os.getenv("FFMPEG_COMMAND", "ffmpeg")
        self.ffprobe_command = os.getenv("FFPROBE_COMMAND", "ffprobe")

    def normalize(self, request: TranscriptionRequest, source_path: Path) -> NormalizedAudio:
        if not shutil.which(self.ffmpeg_command) or not shutil.which(self.ffprobe_command):
            raise RuntimeError("ffmpeg and ffprobe are required for audio normalization.")
        self.output_directory.mkdir(parents=True, exist_ok=True)
        output_path = self.output_directory / "normalized-stereo-44100.wav"
        probe = self.command_runner(
            [
                self.ffprobe_command, "-v", "error", "-select_streams", "a:0",
                "-show_entries", "stream=sample_rate,channels:format=duration",
                "-of", "json", str(source_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if probe.returncode != 0:
            raise RuntimeError(f"ffprobe could not read audio: {(probe.stderr or probe.stdout)[-500:]}")
        try:
            info = json.loads(probe.stdout)
            stream = info["streams"][0]
            duration = float(info["format"]["duration"])
            int(stream["sample_rate"])
            int(stream["channels"])
        except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise RuntimeError("ffprobe returned incomplete audio metadata.") from error
        if duration <= 0:
            raise RuntimeError("Audio duration must be positive.")
        render = self.command_runner(
            [
                self.ffmpeg_command, "-y", "-i", str(source_path), "-vn",
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(output_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if render.returncode != 0 or not output_path.exists():
            raise RuntimeError(f"ffmpeg could not normalize audio: {(render.stderr or render.stdout)[-500:]}")
        return NormalizedAudio(
            path=output_path,
            duration_seconds=duration,
            sample_rate_hz=44100,
            channels=2,
        )
