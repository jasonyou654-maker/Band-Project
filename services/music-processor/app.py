"""BandProject server-side music processor.

Runs Audiveris for score images/PDFs and Spotify Basic Pitch for audio. This
service is intentionally separate from the web app so either engine can be
replaced or replaced without changing the UI.
"""
from __future__ import annotations

import base64
import os
import shutil
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BandProject Music Processor", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("WEB_ORIGINS", "http://localhost:3000,http://localhost:3001").split(","), allow_methods=["POST", "GET"], allow_headers=["*"])

AUDIVERIS_COMMAND = os.getenv("AUDIVERIS_COMMAND", "audiveris")
MAX_SCORE_BYTES = 25 * 1024 * 1024
MAX_AUDIO_BYTES = 50 * 1024 * 1024


@app.get("/health")
def health() -> dict:
    return {
        "status": "ready",
        "audiveris": bool(shutil.which(AUDIVERIS_COMMAND)),
        "basicPitch": module_available("basic_pitch"),
        "music21": module_available("music21"),
    }


@app.post("/omr")
async def omr(file: UploadFile = File(...)) -> dict:
    content = await limited_read(file, MAX_SCORE_BYTES)
    suffix = Path(file.filename or "score.pdf").suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg"}:
        raise HTTPException(415, "Audiveris accepts PDF, PNG, JPG, and JPEG files.")
    executable = shutil.which(AUDIVERIS_COMMAND)
    if not executable:
        raise HTTPException(503, "Audiveris is not installed in the processing service image.")
    with tempfile.TemporaryDirectory(prefix="bandproject-omr-") as directory:
        work = Path(directory)
        source = work / f"source{suffix}"
        output = work / "output"
        output.mkdir()
        source.write_bytes(content)
        command = [executable, "-batch", "-transcribe", "-export", "-output", str(output), "--", str(source)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired as error:
            raise HTTPException(504, "Audiveris timed out while processing this score.") from error
        musicxml = next(iter(output.rglob("*.musicxml")), None) or next(iter(output.rglob("*.mxl")), None)
        if result.returncode != 0 or not musicxml:
            detail = (result.stderr or result.stdout or "No MusicXML output")[-1200:]
            raise HTTPException(422, f"Audiveris could not recognize the score: {detail}")
        xml_text = read_musicxml_output(musicxml)
        layout_markers = inspect_layout_markers(xml_text)
        warnings = []
        if not layout_markers["hasEncodedLayout"]:
            warnings.append("Recognition succeeded, but the source did not expose page/system coordinates; notation spacing may be re-engraved.")
        return {
            "musicXml": xml_text,
            "provider": "Audiveris (source layout)",
            "mode": "real",
            "warnings": warnings,
            "layout": layout_markers,
        }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict:
    content = await limited_read(file, MAX_AUDIO_BYTES)
    suffix = Path(file.filename or "audio.wav").suffix.lower()
    if suffix not in {".wav", ".mp3", ".m4a", ".ogg", ".flac"}:
        raise HTTPException(415, "Basic Pitch accepts WAV, MP3, M4A, OGG, and FLAC files.")
    try:
        from basic_pitch.inference import predict
        from music21 import converter
    except ImportError as error:
        raise HTTPException(503, "Basic Pitch and music21 are not installed in the processing service.") from error
    with tempfile.TemporaryDirectory(prefix="bandproject-audio-") as directory:
        work = Path(directory)
        source = work / f"source{suffix}"
        midi_path = work / "transcription.mid"
        xml_path = work / "transcription.musicxml"
        source.write_bytes(content)
        try:
            _model_output, midi_data, raw_events = predict(str(source))
            midi_data.write(str(midi_path))
            score = converter.parse(str(midi_path))
            score.write("musicxml", fp=str(xml_path))
        except Exception as error:
            raise HTTPException(422, f"Basic Pitch could not transcribe this audio: {error}") from error
        events = [normalize_note_event(event) for event in raw_events]
        return {
            "musicXml": xml_path.read_text(encoding="utf-8"),
            "midiBase64": base64.b64encode(midi_path.read_bytes()).decode("ascii"),
            "noteEvents": events,
            "provider": "Spotify Basic Pitch + music21",
            "mode": "real",
            "warnings": ["Polyphonic transcription is a machine-generated draft and should be reviewed."],
        }


async def limited_read(file: UploadFile, maximum: int) -> bytes:
    content = await file.read(maximum + 1)
    if len(content) > maximum:
        raise HTTPException(413, "Uploaded file is too large.")
    return content


def normalize_note_event(event) -> dict:
    if isinstance(event, dict):
        return {"start": float(event.get("start_time_s", event.get("start", 0))), "end": float(event.get("end_time_s", event.get("end", 0))), "pitch": int(event.get("pitch_midi", event.get("pitch", 60))), "velocity": int(event.get("velocity", 100))}
    start, end, pitch, *rest = event
    amplitude = float(rest[0]) if rest else 0.8
    velocity = round(amplitude * 127) if amplitude <= 1 else round(amplitude)
    return {"start": float(start), "end": float(end), "pitch": int(pitch), "velocity": max(1, min(127, velocity))}


def read_musicxml_output(path: Path) -> str:
    if path.suffix.lower() != ".mxl":
        return path.read_text(encoding="utf-8")
    with zipfile.ZipFile(path) as archive:
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        rootfile = container.find(".//{*}rootfile")
        if rootfile is None or not rootfile.attrib.get("full-path"):
            raise HTTPException(422, "Audiveris returned an MXL archive without a MusicXML root file.")
        return archive.read(rootfile.attrib["full-path"]).decode("utf-8")


def inspect_layout_markers(xml_text: str) -> dict:
    """Report whether Audiveris preserved geometry needed by the web renderer."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {"hasEncodedLayout": False, "pageLayout": False, "systemBreaks": 0, "pageBreaks": 0, "positionedNotes": 0}
    page_layout = root.find(".//{*}page-layout") is not None
    system_breaks = 0
    page_breaks = 0
    for node in root.findall(".//{*}print"):
        system_breaks += node.attrib.get("new-system") == "yes"
        page_breaks += node.attrib.get("new-page") == "yes"
    positioned_notes = sum(
        1 for node in root.findall(".//{*}note")
        if "default-x" in node.attrib or "default-y" in node.attrib
    )
    return {
        "hasEncodedLayout": page_layout or system_breaks > 0 or page_breaks > 0 or positioned_notes > 0,
        "pageLayout": page_layout,
        "systemBreaks": system_breaks,
        "pageBreaks": page_breaks,
        "positionedNotes": positioned_notes,
    }


def module_available(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False
