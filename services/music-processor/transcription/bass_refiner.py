"""Optional BabySlakh-trained low-frequency evidence for bass transcription."""
from __future__ import annotations

import os
from pathlib import Path


def build_bass_mask_model(torch):
    """Build the tiny model without importing torch on workers that do not use it."""
    nn = torch.nn

    class BassResidualMask(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.net = nn.Sequential(
                nn.Conv2d(1, 24, 5, padding=2), nn.GELU(),
                nn.Conv2d(24, 24, 3, padding=1, groups=6), nn.GELU(),
                nn.Conv2d(24, 1, 1), nn.Sigmoid(),
            )

        def forward(self, magnitude):
            return magnitude * self.net(torch.log1p(magnitude))

    return BassResidualMask()


class BabySlakhBassRefiner:
    """Generate a second, learned bass estimate while preserving Demucs audio."""

    def __init__(self, checkpoint: Path) -> None:
        self.checkpoint = checkpoint

    @classmethod
    def from_environment(cls) -> "BabySlakhBassRefiner | None":
        value = os.getenv("BASS_REFINER_CHECKPOINT", "").strip()
        checkpoint = Path(value) if value else None
        return cls(checkpoint) if checkpoint and checkpoint.is_file() else None

    def refine(self, mixture_path: Path, output_path: Path) -> Path:
        try:
            import torch
            import torchaudio
        except ImportError as error:
            raise RuntimeError("The BabySlakh bass refiner requires torch and torchaudio.") from error
        state = torch.load(self.checkpoint, map_location="cpu", weights_only=True)
        sample_rate = int(state.get("sample_rate", 16000))
        n_fft = int(state.get("n_fft", 1024))
        hop_length = int(state.get("hop_length", 256))
        model = build_bass_mask_model(torch)
        model.load_state_dict(state["model"])
        model.eval()
        waveform, source_rate = torchaudio.load(mixture_path)
        waveform = waveform.mean(0, keepdim=True)
        if source_rate != sample_rate:
            waveform = torchaudio.functional.resample(waveform, source_rate, sample_rate)
        window = torch.hann_window(n_fft)
        with torch.inference_mode():
            spectrum = torch.stft(waveform[0], n_fft, hop_length, window=window, return_complex=True)
            predicted_magnitude = model(spectrum.abs()[None, None])[0, 0]
            prediction = torch.istft(
                predicted_magnitude * torch.exp(1j * torch.angle(spectrum)),
                n_fft, hop_length, window=window, length=waveform.shape[-1],
            ).clamp(-1, 1)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        torchaudio.save(output_path, prediction[None], sample_rate, encoding="PCM_F", bits_per_sample=32)
        return output_path
