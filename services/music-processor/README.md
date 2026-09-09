# BandProject music processor

This is the server-only processing tier. Browsers upload to the Next.js API;
the API forwards jobs here through `OMRProvider` or `TranscriptionProvider`.

Set `MUSIC_PROCESSOR_URL=http://processor:4318` on the web deployment.

- `POST /omr`: PDF/image → Audiveris → MusicXML
- `POST /transcribe`: audio → Spotify Basic Pitch → MIDI → music21 → MusicXML
- `GET /health`: reports which engines are installed

The included Dockerfile installs Basic Pitch and its Python dependencies. A
Linux Audiveris distribution must be added to the production image at
`/usr/local/bin/audiveris`; this repository's bundled `.app` is macOS-specific
and is deliberately not treated as a portable server dependency.
