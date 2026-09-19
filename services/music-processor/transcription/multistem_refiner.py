"""Slakh-trained full-band four-stem evidence model.

The learned estimates never replace the float32 Demucs stems. They are used as
an independent analysis pass, so agreement can improve transcription while a
weak small-data checkpoint cannot destructively alter exported audio.
"""
from __future__ import annotations

import os
from pathlib import Path

STEM_NAMES = ("bass", "drums", "vocals", "other")


def build_multistem_mask_model(torch):
    nn = torch.nn

    class MultibandStemMask(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.encoder = nn.Sequential(
                nn.Conv2d(1, 32, 5, padding=2), nn.GELU(),
                nn.Conv2d(32, 48, 3, padding=1), nn.GELU(),
                nn.Conv2d(48, 48, 3, padding=1, groups=8), nn.GELU(),
                nn.Conv2d(48, len(STEM_NAMES), 1),
            )

        def forward(self, magnitude):
            masks = torch.softmax(self.encoder(torch.log1p(magnitude)), dim=1)
            return magnitude * masks

    return MultibandStemMask()


class SlakhMultistemRefiner:
    def __init__(self, checkpoint: Path) -> None:
        self.checkpoint = checkpoint

    @classmethod
    def from_environment(cls) -> "SlakhMultistemRefiner | None":
        value = os.getenv("MULTISTEM_REFINER_CHECKPOINT", "").strip()
        packaged = Path(__file__).parents[1] / "models" / "multistem-mask.pt"
        checkpoint = Path(value) if value else packaged
        return cls(checkpoint) if checkpoint and checkpoint.is_file() else None

    def separate(self, mixture_path: Path, output_directory: Path) -> dict[str, Path]:
        try:
            import soundfile
            import torch
            import torchaudio
        except ImportError as error:
            raise RuntimeError("The Slakh multistem refiner requires torch, torchaudio, and soundfile.") from error
        state = torch.load(self.checkpoint, map_location="cpu", weights_only=True)
        sample_rate = int(state.get("sample_rate", 16000))
        n_fft = int(state.get("n_fft", 1024))
        hop_length = int(state.get("hop_length", 256))
        model = build_multistem_mask_model(torch)
        model.load_state_dict(state["model"])
        model.eval()
        samples, source_rate = soundfile.read(mixture_path, dtype="float32", always_2d=True)
        waveform = torch.from_numpy(samples.T.copy()).mean(0, keepdim=True)
        if source_rate != sample_rate:
            waveform = torchaudio.functional.resample(waveform, source_rate, sample_rate)
        window = torch.hann_window(n_fft)
        chunk_samples = max(5 * sample_rate, int(float(os.getenv("MULTISTEM_CHUNK_SECONDS", "30")) * sample_rate))
        overlap = min(sample_rate, chunk_samples // 4)
        step = chunk_samples - overlap
        separated = torch.zeros(len(STEM_NAMES), waveform.shape[-1])
        weights = torch.zeros(waveform.shape[-1])
        with torch.inference_mode():
            for start in range(0, waveform.shape[-1], step):
                end = min(waveform.shape[-1], start + chunk_samples)
                chunk = waveform[0, start:end]
                spectrum = torch.stft(chunk, n_fft, hop_length, window=window, return_complex=True)
                estimates = model(spectrum.abs()[None, None])[0]
                phase = torch.exp(1j * torch.angle(spectrum))
                chunk_audio = torch.stack([
                    torch.istft(estimate * phase, n_fft, hop_length, window=window, length=chunk.shape[-1])
                    for estimate in estimates
                ])
                envelope = torch.ones(chunk.shape[-1])
                fade = min(overlap, chunk.shape[-1])
                if start:
                    envelope[:fade] = torch.linspace(0, 1, fade)
                if end < waveform.shape[-1]:
                    envelope[-fade:] = torch.linspace(1, 0, fade)
                separated[:, start:end] += chunk_audio * envelope
                weights[start:end] += envelope
        audio = (separated / weights.clamp_min(1e-6)).clamp(-1, 1)
        output_directory.mkdir(parents=True, exist_ok=True)
        paths = {}
        for stem, estimate in zip(STEM_NAMES, audio):
            path = output_directory / f"{stem}-slakh-analysis.wav"
            soundfile.write(path, estimate.numpy(), sample_rate, subtype="FLOAT")
            paths[stem] = path
        return paths
