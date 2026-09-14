# BandProject music processor

This is the server-only processing tier. Browsers upload score images to the
Next.js API; the API forwards them here for server-side Audiveris OMR. The
browser does not perform score recognition.

Set `MUSIC_PROCESSOR_URL=http://processor:4318` on the web deployment.

- `POST /omr`: PDF/image → Audiveris → complete MusicXML
- `POST /omr/jobs`: queued Audiveris OMR for long-running public deployments
- `GET /omr/jobs/{job_id}`: queued-job status and result
- `POST /transcribe`: audio → Spotify Basic Pitch → MIDI → music21 → MusicXML
- `GET /health`: reports which engines are installed

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
