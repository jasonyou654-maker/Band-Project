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
from .bass_refiner import BabySlakhBassRefiner
from .multistem_refiner import SlakhMultistemRefiner


class DemucsSourceSeparator:
    provider = "Demucs Hybrid Transformer (full multitrack)"

    def __init__(self, output_directory: Path, command_runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
        self.output_directory = output_directory
        self.command_runner = command_runner
        self.command = os.getenv("DEMUCS_COMMAND", "demucs")
        self.model = os.getenv("DEMUCS_MODEL", "htdemucs_ft")
        self.ffmpeg_command = os.getenv("FFMPEG_COMMAND", "ffmpeg")
        self.bass_refiner = BabySlakhBassRefiner.from_environment()
        self.multistem_refiner = SlakhMultistemRefiner.from_environment()

    def separate(self, audio: NormalizedAudio, preferred_stem: str | None) -> SeparationResult:
        if not shutil.which(self.command):
            raise RuntimeError("Demucs is not installed in the processing service.")
        self.output_directory.mkdir(parents=True, exist_ok=True)
        # Always render all four stems. Demucs' two-stem mode still computes a
        # full separation and then folds three stems together, which loses the
        # multitrack result that the UI and later analysis stages need.
        command = [
            self.command, "-n", self.model, "-o", str(self.output_directory),
            "--float32", "--shifts", os.getenv("DEMUCS_SHIFTS", "1"),
            "--overlap", os.getenv("DEMUCS_OVERLAP", "0.5"),
        ]
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
        model_input_path = None
        if self.multistem_refiner:
            try:
                learned_stems = self.multistem_refiner.separate(audio.path, selected.parent / "slakh-analysis")
                model_input_path = learned_stems.get(preferred_stem or "other")
            except RuntimeError as error:
                warnings.append(f"Slakh full-band refinement was unavailable: {error}")
        if preferred_stem == "bass" and self.bass_refiner:
            try:
                model_input_path = model_input_path or self.bass_refiner.refine(audio.path, selected.with_name("bass-babyslakh-analysis.wav"))
            except RuntimeError as error:
                warnings.append(f"BabySlakh bass refinement was unavailable: {error}")
        model_input_path = model_input_path or self._make_model_input(selected, preferred_stem)
        return SeparationResult(
            primary_audio=NormalizedAudio(
                path=selected,
                duration_seconds=audio.duration_seconds,
                sample_rate_hz=audio.sample_rate_hz,
                channels=audio.channels,
                model_input_path=model_input_path,
            ),
            stems=stem_paths,
            provider=self.provider,
            version=self.model,
            warnings=tuple(warnings),
        )

    def _make_model_input(self, stem: Path, preferred_stem: str | None) -> Path | None:
        """Create a conservative analysis-only copy without altering the stem.

        The untouched float stem remains the reference pass.  This second copy
        removes only out-of-band energy and a small amount of stationary noise;
        Basic Pitch keeps a note only when the clean/reference evidence agrees.
        Bass retains fundamentals down to 25 Hz, avoiding the common failure of
        voice-oriented denoisers that erase low notes.
        """
        if not shutil.which(self.ffmpeg_command):
            return None
        bands = {
            "bass": (25, 2600),
            "vocals": (55, 12000),
            "drums": (25, 16000),
            "other": (30, 14000),
        }
        low, high = bands.get(preferred_stem or "other", bands["other"])
        output = stem.with_name(f"{stem.stem}-analysis.wav")
        command = [
            self.ffmpeg_command, "-y", "-i", str(stem),
            "-af", f"highpass=f={low},lowpass=f={high},afftdn=nr=5:nf=-50:tn=1:tr=1,alimiter=limit=0.98",
            "-ac", "1", "-ar", "22050", "-c:a", "pcm_f32le", str(output),
        ]
        result = self.command_runner(command, capture_output=True, text=True, check=False)
        return output if result.returncode == 0 and output.exists() else None
