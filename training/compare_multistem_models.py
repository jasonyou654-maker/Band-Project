#!/usr/bin/env python3
"""Compare candidate and production ONNX separators on the same held-out tracks."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from torch.utils.data import DataLoader

from train_multistem_mask import SlakhFourStem, batch_spectra, multiband_loss, track_is_complete


def complete_tracks(root: Path) -> list[Path]:
    candidates = sorted({path.parent for pattern in ("mix.wav", "mix.flac") for path in root.rglob(pattern)})
    return [track for track in candidates if track_is_complete(track)]


def model_loss(model_path: Path, loader: DataLoader, window: torch.Tensor) -> float:
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    total = 0.0
    for mixture, stems in loader:
        mix_spec, target = batch_spectra(mixture, stems, window)
        magnitude = mix_spec[:, None].numpy().astype("float32", copy=False)
        prediction = torch.from_numpy(session.run(["stems"], {"magnitude": magnitude})[0])
        total += float(multiband_loss(prediction, target))
    return total / len(loader)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("training/data/slakh-subset"))
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("training/checkpoints/model-comparison.json"))
    args = parser.parse_args()

    tracks = complete_tracks(args.data)
    if len(tracks) < 2:
        raise RuntimeError("At least two complete Slakh tracks are required for model comparison.")
    validation = tracks[-max(1, len(tracks) // 5):]
    loader = DataLoader(SlakhFourStem(validation, samples_per_track=3, random_offsets=False), batch_size=2)
    window = torch.hann_window(1024)
    baseline_loss = model_loss(args.baseline, loader, window)
    candidate_loss = model_loss(args.candidate, loader, window)
    improvement = 100 * (baseline_loss - candidate_loss) / baseline_loss
    result = {
        "validationTracks": [track.name for track in validation],
        "baselineModel": str(args.baseline),
        "candidateModel": str(args.candidate),
        "baselineLoss": baseline_loss,
        "candidateLoss": candidate_loss,
        "candidateImprovementPercent": improvement,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
    if not np.isfinite(improvement) or improvement <= 0:
        raise SystemExit("Candidate does not beat the production model on the shared held-out set.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
