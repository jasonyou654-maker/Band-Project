#!/usr/bin/env python3
"""Train a compact residual bass mask on BabySlakh mixtures and stems.

This is intentionally a correction model, not a replacement for HT-Demucs. It
learns a conservative residual mask from Slakh bass stems and is intended to be
applied only to the Demucs bass estimate before transcription.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import random

import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset
import torchaudio
import yaml


class BabySlakhBass(Dataset):
    def __init__(self, root: Path, seconds: float = 6.0, samples_per_track: int = 12) -> None:
        self.tracks = sorted(path.parent for path in root.rglob("mix.wav"))
        if not self.tracks:
            raise RuntimeError(f"No BabySlakh mix.wav files found below {root}")
        self.clip_samples = round(seconds * 16000)
        self.samples_per_track = samples_per_track

    def __len__(self) -> int:
        return len(self.tracks) * self.samples_per_track

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        track = self.tracks[index % len(self.tracks)]
        metadata = yaml.safe_load((track / "metadata.yaml").read_text())
        bass_ids = [name for name, item in metadata["stems"].items() if item.get("inst_class") == "Bass" and item.get("audio_rendered")]
        mix, rate = torchaudio.load(track / "mix.wav")
        if rate != 16000:
            mix = torchaudio.functional.resample(mix, rate, 16000)
        mix = mix.mean(0, keepdim=True)
        bass = torch.zeros_like(mix)
        for stem_id in bass_ids:
            stem, stem_rate = torchaudio.load(track / "stems" / f"{stem_id}.wav")
            if stem_rate != 16000:
                stem = torchaudio.functional.resample(stem, stem_rate, 16000)
            bass[..., : stem.shape[-1]] += stem.mean(0, keepdim=True)[..., : bass.shape[-1]]
        maximum = max(0, mix.shape[-1] - self.clip_samples)
        start = random.randint(0, maximum) if maximum else 0
        mix = torch.nn.functional.pad(mix[..., start:start + self.clip_samples], (0, max(0, self.clip_samples - mix[..., start:start + self.clip_samples].shape[-1])))
        bass = torch.nn.functional.pad(bass[..., start:start + self.clip_samples], (0, max(0, self.clip_samples - bass[..., start:start + self.clip_samples].shape[-1])))
        return mix, bass


class BassResidualMask(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 24, 5, padding=2), nn.GELU(),
            nn.Conv2d(24, 24, 3, padding=1, groups=6), nn.GELU(),
            nn.Conv2d(24, 1, 1), nn.Sigmoid(),
        )

    def forward(self, magnitude: torch.Tensor) -> torch.Tensor:
        return magnitude * self.net(torch.log1p(magnitude))


def spectral_loss(prediction: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    return torch.nn.functional.l1_loss(prediction, target) + 0.25 * torch.nn.functional.l1_loss(torch.log1p(prediction), torch.log1p(target))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("training/data/babyslakh"))
    parser.add_argument("--output", type=Path, default=Path("training/checkpoints/bass-mask.pt"))
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--seed", type=int, default=2100)
    args = parser.parse_args()
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")
    loader = DataLoader(BabySlakhBass(args.data), batch_size=args.batch_size, shuffle=True, num_workers=0)
    model = BassResidualMask().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-4)
    history = []
    window = torch.hann_window(1024, device=device)
    for epoch in range(args.epochs):
        running = 0.0
        for mixture, bass in loader:
            mixture, bass = mixture.to(device), bass.to(device)
            mix_stft = torch.stft(mixture[:, 0], 1024, 256, window=window, return_complex=True)
            bass_stft = torch.stft(bass[:, 0], 1024, 256, window=window, return_complex=True)
            predicted = model(mix_stft.abs().unsqueeze(1)).squeeze(1)
            loss = spectral_loss(predicted, bass_stft.abs())
            optimizer.zero_grad(); loss.backward(); optimizer.step()
            running += float(loss.detach())
        history.append(running / len(loader))
        print(f"epoch={epoch + 1} loss={history[-1]:.6f}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": model.state_dict(), "sample_rate": 16000, "n_fft": 1024, "hop_length": 256, "history": history}, args.output)
    args.output.with_suffix(".json").write_text(json.dumps({"dataset": "BabySlakh v2", "seed": args.seed, "epochs": args.epochs, "loss": history}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
