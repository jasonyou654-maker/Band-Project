#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "$0")/.." && pwd)"
image="bandproject-music-processor:sample"
container="bandproject-music-processor-sample"

if docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
  echo "A sample processor container already exists. Stop it first with: docker stop $container" >&2
  exit 1
fi

docker build -t "$image" "$workspace/services/music-processor"
docker run -d --rm \
  --name "$container" \
  -p 4318:4318 \
  -e WEB_ORIGINS=https://jasonyou654-maker.github.io \
  -e ENABLE_SOURCE_SEPARATION=true \
  -e SEPARATION_ENGINE=slakh \
  -e TRANSCRIPTION_ENGINE=fast-spectral \
  -e MULTISTEM_CHUNK_SECONDS=8 \
  "$image"

echo "Sample processor started. Wait for readiness with:"
echo "  curl --fail-with-body http://127.0.0.1:4318/health"
echo "Then copy the public forwarded port URL into GitHub Actions variable MUSIC_PROCESSOR_URL and rerun Deploy GitHub Pages."
