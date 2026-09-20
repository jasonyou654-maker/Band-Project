# BandProject music processor

This is the server-only processing tier. Browsers upload score images to the
Next.js API; the API forwards them here for server-side Audiveris OMR. The
browser does not perform score recognition.

Set `MUSIC_PROCESSOR_URL=http://processor:4318` on the web deployment.

- `POST /omr`: PDF/image → Audiveris → complete MusicXML
- `POST /omr/jobs`: queued Audiveris OMR for long-running public deployments
- `GET /omr/jobs/{job_id}`: queued-job status and result
- `POST /transcribe`: synchronous audio → pipeline → MIDI → MusicXML
- `POST /transcribe/jobs`: queued long-audio transcription task
- `GET /transcribe/jobs/{job_id}`: queued transcription task status/result
- `GET /health`: reports which engines are installed

## Transcription architecture

The `transcription/` package owns the model-agnostic data contracts. Every
pipeline must retain raw candidate events, refined events, beat-grid data,
warnings, model identity, parameters, and processing time. MIDI and MusicXML
are derived exports rather than the system's source of truth. This makes it
possible to replace Basic Pitch or add source separation without changing the
web API.

`/transcribe` remains compatible with the existing web client. Responses now
also include `rawNoteEvents`, a `beatGrid`, `pipeline` provenance, and the final
pipeline stage. The in-memory job registry is suitable for a single worker only;
production deployment should replace it with a durable queue and object storage
before accepting long jobs at scale.

The included container installs `requirements-separation.txt` and enables the
low-memory Slakh ONNX separator. It retains float32 vocals, drums, bass, and
other stems across the full audible range while weighting 0-250 Hz more
heavily. Inference runs in overlapping chunks so memory does not grow with the
uploaded song. The normalized mix remains untouched for later re-analysis.

The public worker uses `TRANSCRIPTION_ENGINE=fast-spectral`: a single-pass,
vectorized note tracker designed for warm short-clip responses under ten
seconds. Set `TRANSCRIPTION_ENGINE=basic-pitch` when accuracy matters more than
latency; that mode keeps the heavier Spotify model and dual-pass evidence.

Workers with more memory can install Demucs and set `SEPARATION_ENGINE=demucs`.
That path runs the fine-tuned `htdemucs_ft` model and keeps its original float32
stem as the reference while the Slakh result supplies a second analysis pass.

`DEMUCS_MODEL`, `DEMUCS_SHIFTS`, and `DEMUCS_OVERLAP` can tune the quality/cost
tradeoff. Production defaults are `htdemucs_ft`, one shift, and 0.5 overlap.
Send `source_type=mix` and optionally `strict_rhythm=true` in a transcription
form request to enable mix-aware routing and canonical-score quantization.

The included Dockerfile installs the official Linux Audiveris 5.10.2 release,
its bundled Java runtime, Tesseract OCR, Basic Pitch, and music21. The
repository's local `.app` remains macOS-specific and is not copied into the
container.

Build and run the processor independently from the static website:

```bash
docker build -t bandproject-music-processor services/music-processor
docker run --rm -p 4318:4318 \
  -e WEB_ORIGINS=https://YOUR_NAME.github.io bandproject-music-processor
```

## Production: Google Cloud Run

The included Dockerfile can be deployed unchanged. For this CPU-bound service,
do not use scale-to-zero: a sleeping instance makes a browser upload fail
before transcription begins. The deployment script creates an Artifact
Registry repository when required, builds the container, then configures one
minimum warm Cloud Run instance. It deliberately keeps concurrency at one so
two simultaneous audio analyses do not compete for the same model memory and
CPU.

Prerequisites: a Google Cloud project with billing enabled, the `gcloud` CLI
authenticated for that project, and permission to enable APIs and deploy Cloud
Run services.

```bash
./scripts/deploy-cloud-run.sh YOUR_GCP_PROJECT_ID asia-southeast1
```

The command prints the HTTPS processor URL. Verify it before changing the
website:

```bash
curl --fail-with-body https://YOUR_CLOUD_RUN_URL/health
```

Then set the GitHub Actions repository variable `MUSIC_PROCESSOR_URL` to that
exact URL and push or re-run **Deploy GitHub Pages**. The workflow reads that
variable at build time; until it is set, it continues using the existing
processor URL. Keep the previous service running until a real `/transcribe`
upload has returned notes and MusicXML from Cloud Run.

The processor runtime is Python 3.11. Basic Pitch 0.4.0 does not support a
native Apple Silicon Python 3.12 installation because of its TensorFlow macOS
dependency constraint. Use this container for local processor development on
macOS as well; CI builds the same image and imports Basic Pitch and librosa
before accepting a change.
