#!/usr/bin/env python3
"""Export the trained four-stem checkpoint to the low-memory runtime format."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

import torch

SERVICE_ROOT = Path(__file__).parents[1] / "services" / "music-processor"
sys.path.insert(0, str(SERVICE_ROOT))
from transcription.multistem_refiner import build_multistem_mask_model  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=Path("training/checkpoints/multistem-mask.pt"))
    parser.add_argument("--output", type=Path, default=Path("services/music-processor/models/multistem-mask.onnx"))
    args = parser.parse_args()
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model = build_multistem_mask_model(torch)
    model.load_state_dict(state["model"])
    model.eval()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        (torch.ones(1, 1, 513, 64),),
        args.output,
        input_names=["magnitude"],
        output_names=["stems"],
        dynamic_axes={"magnitude": {2: "frequency", 3: "frames"}, "stems": {2: "frequency", 3: "frames"}},
        opset_version=18,
        dynamo=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
