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
from torch.utils.data import DataLoader, Dataset
import torchaudio
import yaml

SERVICE_ROOT = Path(__file__).parents[1] / "services" / "music-processor"
import sys
sys.path.insert(0, str(SERVICE_ROOT))
from transcription.bass_refiner import build_bass_mask_model  # noqa: E402


class BabySlakhBass(Dataset):
    def __init__(self, root: Path, seconds: float = 6.0, samples_per_track: int = 12, tracks: list[Path] | None = None) -> None:
        self.tracks = tracks or sorted({path.parent for pattern in ("mix.wav", "mix.flac") for path in root.rglob(pattern)})
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
        mix_path = next(path for path in (track / "mix.wav", track / "mix.flac") if path.exists())
        mix, rate = torchaudio.load(mix_path)
        if rate != 16000:
            mix = torchaudio.functional.resample(mix, rate, 16000)
        mix = mix.mean(0, keepdim=True)
        bass = torch.zeros_like(mix)
        for stem_id in bass_ids:
            stem_path = next(path for path in (track / "stems" / f"{stem_id}.wav", track / "stems" / f"{stem_id}.flac") if path.exists())
            stem, stem_rate = torchaudio.load(stem_path)
            if stem_rate != 16000:
                stem = torchaudio.functional.resample(stem, stem_rate, 16000)
            bass[..., : stem.shape[-1]] += stem.mean(0, keepdim=True)[..., : bass.shape[-1]]
        maximum = max(0, mix.shape[-1] - self.clip_samples)
        start = random.randint(0, maximum) if maximum else 0
        mix = torch.nn.functional.pad(mix[..., start:start + self.clip_samples], (0, max(0, self.clip_samples - mix[..., start:start + self.clip_samples].shape[-1])))
        bass = torch.nn.functional.pad(bass[..., start:start + self.clip_samples], (0, max(0, self.clip_samples - bass[..., start:start + self.clip_samples].shape[-1])))
        return mix, bass


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
    tracks = sorted({path.parent for pattern in ("mix.wav", "mix.flac") for path in args.data.rglob(pattern)})
    if len(tracks) < 2:
        raise RuntimeError("At least two complete Slakh tracks are required for train/validation separation.")
    validation_tracks = tracks[-max(1, len(tracks) // 5):]
    training_tracks = tracks[:-len(validation_tracks)]
    loader = DataLoader(BabySlakhBass(args.data, tracks=training_tracks), batch_size=args.batch_size, shuffle=True, num_workers=0)
    validation_loader = DataLoader(BabySlakhBass(args.data, samples_per_track=3, tracks=validation_tracks), batch_size=args.batch_size, shuffle=False, num_workers=0)
    model = build_bass_mask_model(torch).to(device)
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
        training_loss = running / len(loader)
        model.eval()
        validation_loss = 0.0
        with torch.inference_mode():
            for mixture, bass in validation_loader:
                mixture, bass = mixture.to(device), bass.to(device)
                mix_stft = torch.stft(mixture[:, 0], 1024, 256, window=window, return_complex=True)
                bass_stft = torch.stft(bass[:, 0], 1024, 256, window=window, return_complex=True)
                validation_loss += float(spectral_loss(model(mix_stft.abs().unsqueeze(1)).squeeze(1), bass_stft.abs()))
        model.train()
        metrics = {"epoch": epoch + 1, "trainingLoss": training_loss, "validationLoss": validation_loss / len(validation_loader)}
        history.append(metrics)
        print(f"epoch={epoch + 1} train={metrics['trainingLoss']:.6f} validation={metrics['validationLoss']:.6f}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": model.state_dict(), "sample_rate": 16000, "n_fft": 1024, "hop_length": 256, "history": history}, args.output)
    args.output.with_suffix(".json").write_text(json.dumps({"dataset": "Slakh2100 subset", "seed": args.seed, "epochs": args.epochs, "trainingTracks": [path.name for path in training_tracks], "validationTracks": [path.name for path in validation_tracks], "metrics": history}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
