#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="$workspace/.codespaces-runtime"
venv="$runtime_dir/processor-venv"
log_file="$runtime_dir/processor.log"
pid_file="$runtime_dir/processor.pid"
processor_url="http://127.0.0.1:4318"

mkdir -p "$runtime_dir"

if ! command -v ffmpeg >/dev/null || ! python3 -c 'import venv' >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ffmpeg libsndfile1 python3-venv
fi

if [ ! -x "$venv/bin/python" ]; then
  python3 -m venv "$venv"
fi

if ! "$venv/bin/python" -c 'import fastapi, librosa, music21, onnxruntime, soundfile, uvicorn' >/dev/null 2>&1; then
  "$venv/bin/python" -m pip install --upgrade pip
  "$venv/bin/python" -m pip install -r "$workspace/services/music-processor/requirements-fast.txt"
fi

if ! curl --silent --fail "$processor_url/health" >/dev/null 2>&1; then
  (
    cd "$workspace/services/music-processor"
    exec env \
      WEB_ORIGINS=http://localhost:3000 \
      ENABLE_SOURCE_SEPARATION=true \
      SEPARATION_ENGINE=slakh \
      TRANSCRIPTION_ENGINE=fast-spectral \
      MULTISTEM_CHUNK_SECONDS=8 \
      "$venv/bin/python" -m uvicorn app:app --host 0.0.0.0 --port 4318
  ) >"$log_file" 2>&1 &
  processor_pid=$!
  echo "$processor_pid" >"$pid_file"

  for _ in $(seq 1 90); do
    if curl --silent --fail "$processor_url/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$processor_pid" 2>/dev/null; then
      tail -80 "$log_file" >&2
      exit 1
    fi
    sleep 2
  done
fi

health="$(curl --silent --fail "$processor_url/health")"
echo "Processor ready: $health"

if ! command -v pnpm >/dev/null; then
  if command -v corepack >/dev/null; then
    corepack enable
  else
    npm install --global pnpm@10
  fi
fi

if [ ! -d "$workspace/node_modules" ]; then
  pnpm --dir "$workspace" install --frozen-lockfile
fi

echo "Starting the sample web app on port 3000..."
exec env MUSIC_PROCESSOR_URL="$processor_url" pnpm --dir "$workspace" dev -- --host 0.0.0.0
