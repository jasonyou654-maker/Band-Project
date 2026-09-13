#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

"${PYTHON_BIN:-python3}" tools/omr_service.py &
omr_pid=$!
cleanup() {
  kill "$omr_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

MUSIC_PROCESSOR_URL=http://127.0.0.1:4318 pnpm run dev
