#!/usr/bin/env python3
"""Train a full-band four-stem correction model on a compact Slakh subset."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
import sys

import torch
from torch.utils.data import DataLoader, Dataset
import torchaudio
import soundfile
import yaml

SERVICE_ROOT = Path(__file__).parents[1] / "services" / "music-processor"
sys.path.insert(0, str(SERVICE_ROOT))
from transcription.multistem_refiner import STEM_NAMES, build_multistem_mask_model  # noqa: E402


def stem_group(item: dict) -> str:
    instrument = str(item.get("inst_class", "")).lower()
    program = str(item.get("midi_program_name", "")).lower()
    if instrument == "bass": return "bass"
    if item.get("is_drum") or instrument == "drums": return "drums"
    if instrument in {"voice", "vocals"} or "choir" in program or "voice" in program: return "vocals"
    return "other"


def track_is_complete(track: Path) -> bool:
    metadata_path = track / "metadata.yaml"
    if not metadata_path.is_file():
        return False
    metadata = yaml.safe_load(metadata_path.read_text())
    rendered = [stem_id for stem_id, item in metadata.get("stems", {}).items() if item.get("audio_rendered")]
    return bool(rendered) and all(
        (track / "stems" / f"{stem_id}.flac").is_file()
        or (track / "stems" / f"{stem_id}.wav").is_file()
        for stem_id in rendered
    )


class SlakhFourStem(Dataset):
    def __init__(self, tracks: list[Path], seconds: float = 6.0, samples_per_track: int = 12, random_offsets: bool = True) -> None:
        self.tracks = tracks
        self.clip_samples = round(seconds * 16000)
        self.samples_per_track = samples_per_track
        self.random_offsets = random_offsets
        self.cache: dict[Path, tuple[torch.Tensor, torch.Tensor]] = {}

    def __len__(self): return len(self.tracks) * self.samples_per_track

    @staticmethod
    def audio_path(track: Path, stem_id: str | None = None) -> Path:
        candidates = (track / "mix.wav", track / "mix.flac") if stem_id is None else (track / "stems" / f"{stem_id}.wav", track / "stems" / f"{stem_id}.flac")
        return next(path for path in candidates if path.exists())

    def load(self, path: Path) -> torch.Tensor:
        samples, rate = soundfile.read(path, dtype="float32", always_2d=True)
        audio = torch.from_numpy(samples.T.copy()).mean(0, keepdim=True)
        return torchaudio.functional.resample(audio, rate, 16000) if rate != 16000 else audio

    def __getitem__(self, index):
        track = self.tracks[index % len(self.tracks)]
        if track not in self.cache:
            metadata = yaml.safe_load((track / "metadata.yaml").read_text())
            mixture = self.load(self.audio_path(track))
            targets = {name: torch.zeros_like(mixture) for name in STEM_NAMES}
            for stem_id, item in metadata["stems"].items():
                if not item.get("audio_rendered"): continue
                path = track / "stems" / f"{stem_id}.flac"
                if not path.exists(): path = track / "stems" / f"{stem_id}.wav"
                if not path.exists(): continue
                stem = self.load(path)
                usable = min(stem.shape[-1], mixture.shape[-1])
                targets[stem_group(item)][..., :usable] += stem[..., :usable]
            self.cache[track] = mixture, torch.cat([targets[name] for name in STEM_NAMES], dim=0)
        mixture, grouped_targets = self.cache[track]
        maximum = max(0, mixture.shape[-1] - self.clip_samples)
        sample_number = index // len(self.tracks)
        start = random.randint(0, maximum) if maximum and self.random_offsets else round(maximum * sample_number / max(1, self.samples_per_track - 1))
        def clip(audio):
            value = audio[..., start:start + self.clip_samples]
            return torch.nn.functional.pad(value, (0, max(0, self.clip_samples - value.shape[-1])))
        return clip(mixture), clip(grouped_targets)


def multiband_loss(prediction, target, sample_rate=16000, n_fft=1024):
    frequencies = torch.linspace(0, sample_rate / 2, prediction.shape[-2], device=prediction.device)
    weights = torch.ones_like(frequencies)
    weights = torch.where(frequencies <= 250, 2.25, weights)
    weights = torch.where((frequencies > 250) & (frequencies <= 4000), 1.25, weights)
    weights = torch.where(frequencies > 4000, 1.10, weights)
    absolute = ((prediction - target).abs() * weights[None, None, :, None]).mean()
    logarithmic = torch.nn.functional.l1_loss(torch.log1p(prediction), torch.log1p(target))
    consistency = torch.nn.functional.l1_loss(prediction.sum(1), target.sum(1))
    return absolute + 0.25 * logarithmic + 0.15 * consistency


def batch_spectra(mixture, stems, window):
    mix_spec = torch.stft(mixture[:, 0], 1024, 256, window=window, return_complex=True).abs()
    target = torch.stack([torch.stft(stems[:, index], 1024, 256, window=window, return_complex=True).abs() for index in range(len(STEM_NAMES))], dim=1)
    return mix_spec, target


def validation_loss(model, loader, device, window):
    model.eval(); total = 0.0
    with torch.inference_mode():
        for mixture, stems in loader:
            mixture, stems = mixture.to(device), stems.to(device)
            mix_spec, target = batch_spectra(mixture, stems, window)
            total += float(multiband_loss(model(mix_spec[:, None]), target))
    return total / len(loader)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("training/data/slakh-subset"))
    parser.add_argument("--output", type=Path, default=Path("training/checkpoints/multistem-mask.pt"))
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--seed", type=int, default=2100)
    args = parser.parse_args()
    torch.manual_seed(args.seed); random.seed(args.seed)
    candidates = sorted({path.parent for pattern in ("mix.wav", "mix.flac") for path in args.data.rglob(pattern)})
    tracks = [track for track in candidates if track_is_complete(track)]
    ignored = [track.name for track in candidates if track not in tracks]
    if ignored: print(json.dumps({"ignoredIncompleteTracks": ignored}))
    if len(tracks) < 2: raise RuntimeError("At least two complete Slakh tracks are required.")
    validation = tracks[-max(1, len(tracks) // 5):]; training = tracks[:-len(validation)]
    train_loader = DataLoader(SlakhFourStem(training), batch_size=args.batch_size, shuffle=True)
    validation_loader = DataLoader(SlakhFourStem(validation, samples_per_track=3, random_offsets=False), batch_size=args.batch_size)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")
    model = build_multistem_mask_model(torch).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-4)
    window = torch.hann_window(1024, device=device); history = []
    baseline_validation = validation_loss(model, validation_loader, device, window)
    print(json.dumps({"epoch": 0, "validationLoss": baseline_validation, "kind": "untrainedBaseline"}))
    for epoch in range(args.epochs):
        model.train(); total = 0.0
        for mixture, stems in train_loader:
            mixture, stems = mixture.to(device), stems.to(device)
            mix_spec, target = batch_spectra(mixture, stems, window)
            loss = multiband_loss(model(mix_spec[:, None]), target)
            optimizer.zero_grad(); loss.backward(); optimizer.step(); total += float(loss.detach())
        metrics = {"epoch": epoch + 1, "trainingLoss": total / len(train_loader), "validationLoss": validation_loss(model, validation_loader, device, window)}
        history.append(metrics); print(json.dumps(metrics))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": model.state_dict(), "stems": STEM_NAMES, "sample_rate": 16000, "n_fft": 1024, "hop_length": 256, "history": history}, args.output)
    improvement = 100 * (baseline_validation - history[-1]["validationLoss"]) / baseline_validation
    args.output.with_suffix(".json").write_text(json.dumps({"dataset": "Slakh2100 subset", "trainingTracks": [p.name for p in training], "validationTracks": [p.name for p in validation], "frequencyWeighting": {"0-250Hz": 2.25, "250-4000Hz": 1.25, "4000-8000Hz": 1.10}, "baselineValidationLoss": baseline_validation, "validationImprovementPercent": improvement, "metrics": history}, indent=2))
    return 0


if __name__ == "__main__": raise SystemExit(main())
