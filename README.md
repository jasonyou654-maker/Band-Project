# BandProject

BandProject is a data-driven sheet-music community and transcription workspace.
The web client accepts MusicXML, scanned scores, PDFs, and audio while all
model/runtime dependencies stay on the server.

## Processing architecture

```text
MusicXML ────────────────────────────────→ OpenSheetMusicDisplay
PDF/image → Browser OMR ────────────────→ MusicXML → OpenSheetMusicDisplay
          ↘ OMRProvider → Audiveris (when configured)
Audio → TranscriptionProvider → Basic Pitch → MIDI → music21 → MusicXML → OSMD
```

The Next.js routes are stable integration points:

- `POST /api/omr`
- `POST /api/transcribe`
- `GET/POST /api/sheets`

PDF, PNG, and JPG files can be recognized directly in the browser, including
on the static GitHub Pages build. When `MUSIC_PROCESSOR_URL` is configured the
app tries the Audiveris processor first and automatically falls back to the
browser engine if the service is unavailable. It never publishes a sample
score as if it came from a scan.

## Data

- D1 stores searchable sheet metadata and MusicXML.
- R2 archives uploaded score/audio source files.
- Browser storage is used only as a local-development fallback when D1 is not
  attached.

The generated migration is in `drizzle/` and logical bindings are declared in
`.openai/hosting.json`.

## Server-side processor

`services/music-processor` contains the deployable FastAPI processing tier.
Its container installs the official Audiveris 5.10.2 Linux release, Tesseract,
Spotify Basic Pitch, music21, and ffmpeg. The repository's macOS `.app` is used
only by local development.

Set the web service's private environment variable after deploying the
processor:

```text
MUSIC_PROCESSOR_URL=http://music-processor:4318
```

End users only open BandProject in a browser. They do not install Python,
Basic Pitch, Audiveris, MuseScore, or any other desktop dependency.

## Development

```bash
pnpm run dev:omr
pnpm test
```

On Apple Silicon macOS, `dev:omr` starts both the bundled Audiveris bridge and
the web app. PDF, PNG, and JPG uploads are recognized automatically; MusicXML
uploads are read directly. The bundled `tools/Audiveris.app` is intentionally
gitignored, so a fresh checkout must install Audiveris separately or connect
the FastAPI processor with `MUSIC_PROCESSOR_URL`.

For a static GitHub Pages deployment, set the repository Actions variable
`MUSIC_PROCESSOR_URL` to the public HTTPS URL of `services/music-processor`.
The build exposes it to the browser as `NEXT_PUBLIC_MUSIC_PROCESSOR_URL`. Set
the processor's `WEB_ORIGINS` to the website origin so browser uploads pass
CORS checks.
