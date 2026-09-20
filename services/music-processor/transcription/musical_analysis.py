"""Evidence-backed musical summaries derived from transcribed note events."""
from __future__ import annotations

from collections import defaultdict
from math import sqrt

from .contracts import TranscriptionResult


PITCH_NAMES = ("C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B")
MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)
MINIMUM_KEY_CONFIDENCE = 8
MINIMUM_CHORD_CONFIDENCE = 12


def summarize_transcription(result: TranscriptionResult) -> dict:
    events = result.refined_events or result.raw_events
    key = estimate_key(events)
    chords = estimate_chords(events)
    beat_grid = result.beat_grid
    duration = None
    if result.metadata:
        duration = result.metadata.parameters.get("durationSeconds")
    return {
        "duration": duration,
        "bpm": round(beat_grid.bpm) if beat_grid.bpm else None,
        "tempoConfidence": round((beat_grid.confidence or 0) * 100),
        "key": key["key"],
        "mode": key["mode"],
        "keyConfidence": key["confidence"],
        "timeSignature": list(beat_grid.time_signature) if beat_grid.time_signature else None,
        "chords": chords["labels"],
        "chordConfidence": chords["confidence"],
        "instruments": [],
        "sections": [],
        "noteCount": len(events),
        "provider": f"{result.metadata.transcriber} note evidence" if result.metadata else "Audio note evidence",
    }


def estimate_key(events) -> dict:
    if len(events) < 4:
        return {"key": None, "mode": None, "confidence": 0}
    chroma = [0.0] * 12
    for event in events:
        duration = max(0.0, event.end_seconds - event.start_seconds)
        evidence = duration * max(1, event.velocity) * (event.confidence if event.confidence is not None else 0.5)
        chroma[event.midi_pitch % 12] += evidence
    total = sum(chroma)
    if total <= 0:
        return {"key": None, "mode": None, "confidence": 0}
    normalized = [value / total for value in chroma]
    if sum(value > 0 for value in normalized) < 4:
        return {"key": None, "mode": None, "confidence": 0}
    centered_chroma = [value - sum(normalized) / 12 for value in normalized]

    def correlation(profile, root):
        centered_profile = [profile[(index - root) % 12] - sum(profile) / 12 for index in range(12)]
        denominator = sqrt(sum(value * value for value in centered_chroma) * sum(value * value for value in centered_profile))
        return sum(left * right for left, right in zip(centered_chroma, centered_profile)) / denominator if denominator else 0.0

    candidates: list[tuple[float, int, str]] = []
    for root in range(12):
        major = correlation(MAJOR_PROFILE, root)
        minor = correlation(MINOR_PROFILE, root)
        candidates.extend(((major, root, "major"), (minor, root, "minor")))
    candidates.sort(reverse=True)
    best, runner_up = candidates[0], candidates[1]
    confidence = max(0, min(100, round((best[0] - runner_up[0]) * 50)))
    if confidence < MINIMUM_KEY_CONFIDENCE:
        return {"key": None, "mode": None, "confidence": confidence}
    return {"key": PITCH_NAMES[best[1]], "mode": best[2], "confidence": confidence}


def estimate_chords(events, segment_seconds: float = 4.0) -> dict:
    if len(events) < 4:
        return {"labels": [], "confidence": 0}
    segments: dict[int, list[float]] = defaultdict(lambda: [0.0] * 12)
    for event in events:
        start_segment = int(event.start_seconds // segment_seconds)
        end_segment = int(max(event.start_seconds, event.end_seconds - 1e-6) // segment_seconds)
        for segment in range(start_segment, end_segment + 1):
            left = max(event.start_seconds, segment * segment_seconds)
            right = min(event.end_seconds, (segment + 1) * segment_seconds)
            if right > left:
                segments[segment][event.midi_pitch % 12] += (right - left) * max(1, event.velocity)
    labels: list[str] = []
    margins: list[float] = []
    for segment in sorted(segments):
        chroma = segments[segment]
        if sum(value > 0 for value in chroma) < 3:
            continue
        candidates: list[tuple[float, str]] = []
        for root in range(12):
            major_score = sum(chroma[pitch] for pitch in (root, (root + 4) % 12, (root + 7) % 12))
            minor_score = sum(chroma[pitch] for pitch in (root, (root + 3) % 12, (root + 7) % 12))
            candidates.extend(((major_score, PITCH_NAMES[root]), (minor_score, f"{PITCH_NAMES[root]}m")))
        candidates.sort(reverse=True)
        best, runner_up = candidates[0], candidates[1]
        margin = max(0.0, (best[0] - runner_up[0]) / max(best[0], 1e-9))
        chord_energy = best[0]
        total_energy = sum(chroma)
        coverage = chord_energy / max(total_energy, 1e-9)
        if margin < MINIMUM_CHORD_CONFIDENCE / 100 or coverage < 0.58:
            continue
        if not labels or labels[-1] != best[1]:
            labels.append(best[1])
        margins.append(margin)
    confidence = round(sum(margins) / len(margins) * 100) if margins else 0
    if confidence < MINIMUM_CHORD_CONFIDENCE:
        return {"labels": [], "confidence": confidence}
    return {"labels": labels, "confidence": confidence}
