"""BandProject server-side music processor.

Runs Audiveris for score images/PDFs and Spotify Basic Pitch for audio. This
service is intentionally separate from the web app so either engine can be
replaced or replaced without changing the UI.
"""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
import os
import shutil
import subprocess
import tempfile
from threading import Lock
from uuid import uuid4
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from transcription.audio import FfmpegAudioPreprocessor
from transcription.basic_pitch_adapter import BasicPitchTranscriber
from transcription.contracts import AudioAsset, TranscriptionRequest
from transcription.demucs_adapter import DemucsSourceSeparator
from transcription.beat_tracking import LibrosaBeatTracker
from transcription.pipeline import TranscriptionPipeline
from transcription.score import GridRhythmQuantizer, Music21ScoreExporter

app = FastAPI(title="BandProject Music Processor", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("WEB_ORIGINS", "http://localhost:3000,http://localhost:3001").split(","), allow_methods=["POST", "GET"], allow_headers=["*"])

AUDIVERIS_COMMAND = os.getenv("AUDIVERIS_COMMAND", "audiveris")
MAX_SCORE_BYTES = 25 * 1024 * 1024
MAX_AUDIO_BYTES = 50 * 1024 * 1024
OMR_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bandproject-omr")
OMR_JOBS: dict[str, dict] = {}
OMR_JOBS_LOCK = Lock()
TRANSCRIPTION_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bandproject-transcription")
TRANSCRIPTION_JOBS: dict[str, dict] = {}
TRANSCRIPTION_JOBS_LOCK = Lock()
TARGET_INSTRUMENTS = {"guitar", "bass", "piano", "vocals", "drums", "chords", "lead-sheet", "auto"}
SOURCE_TYPES = {"isolated", "mix", "unknown"}


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
    validate_score_suffix(suffix)
    return recognize_with_audiveris(content, suffix)


@app.post("/omr/jobs", status_code=202)
async def create_omr_job(file: UploadFile = File(...)) -> dict:
    """Queue long OMR jobs so Render's HTTP proxy does not time out."""
    content = await limited_read(file, MAX_SCORE_BYTES)
    suffix = Path(file.filename or "score.pdf").suffix.lower()
    validate_score_suffix(suffix)
    if not shutil.which(AUDIVERIS_COMMAND):
        raise HTTPException(503, "Audiveris is not installed in the processing service image.")
    job_id = uuid4().hex
    with OMR_JOBS_LOCK:
        OMR_JOBS[job_id] = {"status": "queued"}
    OMR_EXECUTOR.submit(run_omr_job, job_id, content, suffix)
    return {"jobId": job_id, "status": "queued"}


@app.get("/omr/jobs/{job_id}")
def get_omr_job(job_id: str):
    with OMR_JOBS_LOCK:
        job = OMR_JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "OMR job not found. It may have expired after a service restart.")
    if job["status"] == "failed":
        return JSONResponse(status_code=422, content={"status": "failed", "error": job["error"]})
    if job["status"] != "completed":
        return {"status": job["status"]}
    return {"status": "completed", **job["result"]}


def run_omr_job(job_id: str, content: bytes, suffix: str) -> None:
    with OMR_JOBS_LOCK:
        OMR_JOBS[job_id] = {"status": "processing"}
    try:
        result = recognize_with_audiveris(content, suffix)
    except HTTPException as error:
        with OMR_JOBS_LOCK:
            OMR_JOBS[job_id] = {"status": "failed", "error": str(error.detail)}
        return
    except Exception as error:
        with OMR_JOBS_LOCK:
            OMR_JOBS[job_id] = {"status": "failed", "error": f"Audiveris processing failed: {error}"}
        return
    with OMR_JOBS_LOCK:
        OMR_JOBS[job_id] = {"status": "completed", "result": result}


def validate_score_suffix(suffix: str) -> None:
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg"}:
        raise HTTPException(415, "Audiveris accepts PDF, PNG, JPG, and JPEG files.")


def recognize_with_audiveris(content: bytes, suffix: str) -> dict:
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
async def transcribe(file: UploadFile = File(...), target_instrument: str = Form("auto"), source_type: str = Form("unknown"), strict_rhythm: bool = Form(False)) -> dict:
    content = await limited_read(file, MAX_AUDIO_BYTES)
    suffix = Path(file.filename or "audio.wav").suffix.lower()
    return transcribe_audio(content, suffix, file.filename or "audio.wav", target_instrument, source_type, strict_rhythm)


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)) -> dict:
    """Measure tempo and global key from the uploaded waveform, without inventing notation."""
    content = await limited_read(file, MAX_AUDIO_BYTES)
    suffix = Path(file.filename or "audio.wav").suffix.lower()
    validate_audio_request(suffix, "auto", "unknown")
    return analyze_audio_signal(content, suffix)


@app.post("/transcribe/jobs", status_code=202)
async def create_transcription_job(file: UploadFile = File(...), target_instrument: str = Form("auto"), source_type: str = Form("unknown"), strict_rhythm: bool = Form(False)) -> dict:
    """Queue long audio transcription without tying up a public HTTP proxy."""
    content = await limited_read(file, MAX_AUDIO_BYTES)
    suffix = Path(file.filename or "audio.wav").suffix.lower()
    validate_audio_request(suffix, target_instrument, source_type)
    job_id = uuid4().hex
    with TRANSCRIPTION_JOBS_LOCK:
        TRANSCRIPTION_JOBS[job_id] = {"status": "queued", "stage": "queued"}
    TRANSCRIPTION_EXECUTOR.submit(run_transcription_job, job_id, content, suffix, file.filename or "audio.wav", target_instrument, source_type, strict_rhythm)
    return {"jobId": job_id, "status": "queued", "stage": "queued"}


@app.get("/transcribe/jobs/{job_id}")
def get_transcription_job(job_id: str):
    with TRANSCRIPTION_JOBS_LOCK:
        job = TRANSCRIPTION_JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "Transcription job not found. It may have expired after a service restart.")
    if job["status"] == "failed":
        return JSONResponse(status_code=422, content={"status": "failed", "stage": "failed", "error": job["error"]})
    if job["status"] != "completed":
        return {"status": job["status"], "stage": job["stage"]}
    return {"status": "completed", "stage": "completed", **job["result"]}


def run_transcription_job(job_id: str, content: bytes, suffix: str, filename: str, target_instrument: str, source_type: str, strict_rhythm: bool) -> None:
    with TRANSCRIPTION_JOBS_LOCK:
        TRANSCRIPTION_JOBS[job_id] = {"status": "processing", "stage": "transcribing"}
    try:
        result = transcribe_audio(content, suffix, filename, target_instrument, source_type, strict_rhythm)
    except HTTPException as error:
        with TRANSCRIPTION_JOBS_LOCK:
            TRANSCRIPTION_JOBS[job_id] = {"status": "failed", "error": str(error.detail)}
        return
    except Exception as error:
        with TRANSCRIPTION_JOBS_LOCK:
            TRANSCRIPTION_JOBS[job_id] = {"status": "failed", "error": f"Audio transcription failed: {error}"}
        return
    with TRANSCRIPTION_JOBS_LOCK:
        TRANSCRIPTION_JOBS[job_id] = {"status": "completed", "result": result}


def validate_audio_request(suffix: str, target_instrument: str, source_type: str) -> None:
    if suffix not in {".wav", ".mp3", ".m4a", ".ogg", ".flac"}:
        raise HTTPException(415, "Basic Pitch accepts WAV, MP3, M4A, OGG, and FLAC files.")
    if target_instrument not in TARGET_INSTRUMENTS:
        raise HTTPException(400, f"Unsupported target instrument: {target_instrument}.")
    if source_type not in SOURCE_TYPES:
        raise HTTPException(400, f"Unsupported source type: {source_type}.")


def transcribe_audio(content: bytes, suffix: str, filename: str, target_instrument: str, source_type: str, strict_rhythm: bool) -> dict:
    validate_audio_request(suffix, target_instrument, source_type)
    try:
        from music21 import converter
    except ImportError as error:
        raise HTTPException(503, "music21 is not installed in the processing service.") from error
    with tempfile.TemporaryDirectory(prefix="bandproject-audio-") as directory:
        work = Path(directory)
        source = work / f"source{suffix}"
        xml_path = work / "transcription.musicxml"
        source.write_bytes(content)
        request = TranscriptionRequest(
            request_id=uuid4().hex,
            audio=AudioAsset(filename=filename, mime_type="audio/unknown", byte_size=len(content), source_type=source_type),  # type: ignore[arg-type]
            target_instrument=target_instrument,  # type: ignore[arg-type]
            strict_rhythm=strict_rhythm,
        )
        separator = DemucsSourceSeparator(work / "stems") if os.getenv("ENABLE_SOURCE_SEPARATION", "false").lower() == "true" else None
        pipeline = TranscriptionPipeline(
            preprocessor=FfmpegAudioPreprocessor(work / "normalized"),
            transcriber=BasicPitchTranscriber(work / "artifacts"),
            separator=separator,
            beat_tracker=LibrosaBeatTracker(),
            quantizer=GridRhythmQuantizer(),
            score_exporter=Music21ScoreExporter(),
            score_artifacts_directory=work / "artifacts",
        )
        try:
            result = pipeline.run(request, source)
            if result.midi_path is None:
                raise RuntimeError("Basic Pitch did not produce a MIDI artifact.")
            if result.musicxml is None:
                score = converter.parse(str(result.midi_path))
                score.write("musicxml", fp=str(xml_path))
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from error
        except Exception as error:
            raise HTTPException(422, f"Basic Pitch could not transcribe this audio: {error}") from error
        result = replace_transcription_exports(
            result,
            musicxml=result.musicxml or xml_path.read_text(encoding="utf-8"),
            midi_base64=base64.b64encode(result.midi_path.read_bytes()).decode("ascii"),
        )
        payload = result.to_api_dict()
        payload.update({
            "provider": "Spotify Basic Pitch + music21",
            "mode": "real",
        })
        return payload


def analyze_audio_signal(content: bytes, suffix: str) -> dict:
    try:
        import librosa
        import numpy as np
    except ImportError as error:
        raise HTTPException(503, "librosa is not installed in the processing service.") from error
    with tempfile.TemporaryDirectory(prefix="bandproject-analysis-") as directory:
        work = Path(directory)
        source = work / f"source{suffix}"
        source.write_bytes(content)
        try:
            normalized = FfmpegAudioPreprocessor(work / "normalized").prepare(source)
            signal, sample_rate = librosa.load(str(normalized.path), sr=22050, mono=True, duration=180)
        except Exception as error:
            raise HTTPException(422, f"Could not decode audio for analysis: {error}") from error
        if len(signal) < sample_rate * 3:
            raise HTTPException(422, "Audio is too short to measure tempo and key reliably.")
        onset = librosa.onset.onset_strength(y=signal, sr=sample_rate)
        tempo, _ = librosa.beat.beat_track(onset_envelope=onset, sr=sample_rate, trim=False)
        bpm = float(np.asarray(tempo).reshape(-1)[0])
        chroma = librosa.feature.chroma_cqt(y=signal, sr=sample_rate).mean(axis=1)
        chroma = chroma / max(float(chroma.sum()), 1e-9)
        major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
        candidates = []
        for root in range(12):
            candidates.append((float(np.dot(chroma, np.roll(major, root))), root, "major"))
            candidates.append((float(np.dot(chroma, np.roll(minor, root))), root, "minor"))
        candidates.sort(reverse=True)
        best, runner_up = candidates[0], candidates[1]
        key_confidence = max(0, min(100, round((best[0] - runner_up[0]) / max(abs(best[0]), 1e-9) * 100)))
        autocorrelation = np.correlate(onset - onset.mean(), onset - onset.mean(), mode="full")[len(onset) - 1:]
        tempo_confidence = max(0, min(100, round(float(autocorrelation[1:].max()) / max(float(autocorrelation[0]), 1e-9) * 100)))
        return {
            "bpm": round(bpm),
            "tempoConfidence": tempo_confidence,
            "key": ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][best[1]],
            "mode": best[2],
            "keyConfidence": key_confidence,
            "provider": "librosa waveform analysis",
            "warnings": [warning for warning in ["Tempo confidence is low; verify before transcription." if tempo_confidence < 35 else None, "Key confidence is low; verify before transcription." if key_confidence < 20 else None] if warning],
        }


def replace_transcription_exports(result, *, musicxml: str, midi_base64: str):
    """Avoid mutating the immutable domain result while adding derived exports."""
    from dataclasses import replace
    return replace(result, musicxml=musicxml, midi_base64=midi_base64)


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
