#!/usr/bin/env bash
set -euo pipefail

project_id="${1:?Usage: $0 GCP_PROJECT_ID [REGION]}"
region="${2:-asia-southeast1}"
service_name="bandproject-music-processor"
repository="bandproject"
image_tag="$(git -C "$(dirname "$0")/.." rev-parse --short HEAD)"
image="${region}-docker.pkg.dev/${project_id}/${repository}/${service_name}:${image_tag}"
workspace="$(cd "$(dirname "$0")/.." && pwd)"

command -v gcloud >/dev/null || {
  echo "gcloud CLI is required. Install Google Cloud CLI and run: gcloud auth login" >&2
  exit 1
}

gcloud config set project "$project_id"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

if ! gcloud artifacts repositories describe "$repository" --location="$region" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$repository" --repository-format=docker --location="$region"
fi

gcloud builds submit "$workspace/services/music-processor" --tag "$image"
gcloud run deploy "$service_name" \
  --image "$image" \
  --region "$region" \
  --platform managed \
  --allow-unauthenticated \
  --port 4318 \
  --cpu 2 \
  --memory 2Gi \
  --concurrency 1 \
  --timeout 180 \
  --min-instances 1 \
  --max-instances 1 \
  --cpu-boost \
  --set-env-vars "WEB_ORIGINS=https://jasonyou654-maker.github.io,ENABLE_SOURCE_SEPARATION=true,SEPARATION_ENGINE=slakh,TRANSCRIPTION_ENGINE=fast-spectral,MULTISTEM_CHUNK_SECONDS=8"

gcloud run services describe "$service_name" --region "$region" --format='value(status.url)'
