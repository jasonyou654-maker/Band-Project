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

Set `ENABLE_SOURCE_SEPARATION=true` only on workers provisioned for Demucs. The
processor keeps a normalized 44.1 kHz stereo WAV for separation, while Basic
Pitch performs its own mono analysis. Send `source_type=mix` and optionally
`strict_rhythm=true` in a transcription form request to enable mix-aware routing
and canonical-score quantization.

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

The processor runtime is Python 3.11. Basic Pitch 0.4.0 does not support a
native Apple Silicon Python 3.12 installation because of its TensorFlow macOS
dependency constraint. Use this container for local processor development on
macOS as well; CI builds the same image and imports Basic Pitch and librosa
before accepting a change.
