#!/usr/bin/env python3
"""End-to-end production-container smoke test for the public audio contract."""
from __future__ import annotations

from io import BytesIO
import json
import math
import struct
import wave
import xml.etree.ElementTree as ET

import app


def fixture() -> bytes:
    sample_rate = 16000
    duration = 20
    chords = ((60, 64, 67), (65, 69, 72), (67, 71, 74), (60, 64, 67))
    frames = bytearray()
    for index in range(sample_rate * duration):
        seconds = index / sample_rate
        beat = int(seconds)
        phase = seconds - beat
        fade = min(1.0, phase / 0.02, max(0.0, (0.70 - phase) / 0.05))
        tone = sum(
            0.14 * math.sin(2 * math.pi * 440 * 2 ** ((pitch - 69) / 12) * seconds)
            for pitch in chords[(beat // 4) % len(chords)]
        ) * fade
        accent = 1.0 if beat % 4 == 0 else 0.08
        click = 0.55 * accent * math.exp(-phase * 65) * math.sin(2 * math.pi * 900 * seconds)
        frames.extend(struct.pack("<h", round(max(-0.98, min(0.98, tone + click)) * 32767)))
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(frames)
    return output.getvalue()


def main() -> int:
    result = app.transcribe_audio(fixture(), ".wav", "smoke-c-major.wav", "auto", "isolated", True)
    analysis = result["analysis"]
    assert result["mode"] == "real"
    assert len(result["noteEvents"]) >= 12
    assert analysis["noteCount"] == len(result["noteEvents"])
    assert analysis["bpm"] is not None
    assert analysis["key"] == "C" and analysis["mode"] == "major"
    assert analysis["chords"]
    assert "timeSignature" in analysis
    assert result["musicXml"] and result["midiBase64"]
    xml = ET.fromstring(result["musicXml"])
    assert xml.find("./part/measure/direction/sound") is not None
    assert xml.findtext("./part/measure/attributes/key/mode") == "major"
    print(json.dumps({
        "status": "passed",
        "noteCount": analysis["noteCount"],
        "bpm": analysis["bpm"],
        "key": f"{analysis['key']} {analysis['mode']}",
        "timeSignature": analysis["timeSignature"],
        "chords": analysis["chords"],
        "processingSeconds": result["pipeline"]["processing_seconds"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
