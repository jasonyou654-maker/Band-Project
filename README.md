# BandProject

BandProject is a data-driven sheet-music community and transcription workspace.
The web client accepts MusicXML, scanned scores, PDFs, and audio while all
model/runtime dependencies stay on the server.

## Processing architecture

```text
MusicXML ────────────────────────────────→ OpenSheetMusicDisplay
PDF/image → OMRProvider → Audiveris ────→ MusicXML → OpenSheetMusicDisplay
Audio → TranscriptionProvider → Basic Pitch → MIDI → music21 → MusicXML → OSMD
```

The Next.js routes are stable integration points:

- `POST /api/omr`
- `POST /api/transcribe`
- `GET/POST /api/sheets`

`OMRProvider` and `TranscriptionProvider` choose the real HTTP processor when
`MUSIC_PROCESSOR_URL` is configured. Without it they return an explicitly
marked fallback preview; fallback output is never labelled as recognized or
transcribed music.

## Data

- D1 stores searchable sheet metadata and MusicXML.
- R2 archives uploaded score/audio source files.
- Browser storage is used only as a local-development fallback when D1 is not
  attached.

The generated migration is in `drizzle/` and logical bindings are declared in
`.openai/hosting.json`.

## Server-side processor

`services/music-processor` contains the deployable FastAPI processing tier.
Its Python 3.11 container installs Spotify Basic Pitch, music21, ffmpeg, and
Java. A Linux Audiveris launcher must be installed at
`/usr/local/bin/audiveris`; the repository's historical macOS `.app` is not a
portable production dependency.

Set the web service's private environment variable after deploying the
processor:

```text
MUSIC_PROCESSOR_URL=http://music-processor:4318
```

End users only open BandProject in a browser. They do not install Python,
Basic Pitch, Audiveris, MuseScore, or any other desktop dependency.

## Development

```bash
pnpm run dev
pnpm test
```

Direct MusicXML uploads and fallback mode work without the processing service.
Real OMR and Basic Pitch run when the server-side processor is connected.
