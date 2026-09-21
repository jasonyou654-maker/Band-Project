#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "$0")/.." && pwd)"
venv="$workspace/training/.venv"

if ! command -v ffmpeg >/dev/null || ! python3 -c 'import venv' >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ffmpeg libsndfile1 python3-venv
fi

if [ ! -x "$venv/bin/python" ]; then
  python3 -m venv "$venv"
fi

"$venv/bin/python" -m pip install --upgrade pip
"$venv/bin/python" -m pip install -r "$workspace/training/requirements-slakh.txt"

echo "Training environment ready. Activate it with:"
echo "  source training/.venv/bin/activate"
echo "Then download the bounded Slakh subset and train with:"
echo "  python training/download_slakh_subset.py --endpoint https://hf-mirror.com"
echo "  python training/train_multistem_mask.py --data training/data/slakh-subset --epochs 8"
echo "  python training/export_multistem_onnx.py"
