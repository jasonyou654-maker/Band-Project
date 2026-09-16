"""Optional Demucs source-separation adapter.

Demucs is deliberately invoked as a separate process so the orchestration layer
does not depend on its Python internals. It is disabled unless the deployment
explicitly enables it, because separation is expensive and may add artefacts.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
from typing import Callable

from .adapters import SeparationResult
from .audio import NormalizedAudio


class DemucsSourceSeparator:
    provider = "Demucs htdemucs"

    def __init__(self, output_directory: Path, command_runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
        self.output_directory = output_directory
        self.command_runner = command_runner
        self.command = os.getenv("DEMUCS_COMMAND", "demucs")
        self.model = os.getenv("DEMUCS_MODEL", "htdemucs")

    def separate(self, audio: NormalizedAudio, preferred_stem: str | None) -> SeparationResult:
        if not shutil.which(self.command):
            raise RuntimeError("Demucs is not installed in the processing service.")
        self.output_directory.mkdir(parents=True, exist_ok=True)
        command = [self.command, "-n", self.model, "-o", str(self.output_directory)]
        # Demucs supports two-stem extraction for the reliably exposed sources.
        if preferred_stem in {"vocals", "bass", "drums"}:
            command.extend(["--two-stems", preferred_stem])
        command.append(str(audio.path))
        result = self.command_runner(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"Demucs separation failed: {(result.stderr or result.stdout)[-800:]}")
        stem_paths = {path.stem: path for path in self.output_directory.rglob("*.wav")}
        selected = stem_paths.get(preferred_stem or "")
        if selected is None:
            # Full separation routes piano/guitar/chord work through `other`.
            selected = stem_paths.get("other")
        if selected is None:
            raise RuntimeError("Demucs completed without a usable target stem.")
        warnings: list[str] = []
        if preferred_stem in {"other", None}:
            warnings.append("The accompaniment stem is auxiliary evidence, not an isolated target instrument.")
        return SeparationResult(
            primary_audio=NormalizedAudio(
                path=selected,
                duration_seconds=audio.duration_seconds,
                sample_rate_hz=audio.sample_rate_hz,
                channels=audio.channels,
            ),
            stems=stem_paths,
            provider=self.provider,
            version=self.model,
            warnings=tuple(warnings),
        )

