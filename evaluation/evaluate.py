#!/usr/bin/env python3
"""Evaluate BandProject note-event predictions against musician references."""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
from typing import Callable, Iterable


@dataclass(frozen=True)
class Note:
    start: float
    end: float
    pitch: int

    @property
    def duration(self) -> float:
        return self.end - self.start


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def load_notes(payload: dict, path: Path) -> list[Note]:
    raw_notes = payload.get("notes", payload.get("noteEvents"))
    if not isinstance(raw_notes, list):
        raise ValueError(f"{path}: expected a notes or noteEvents array")
    notes: list[Note] = []
    for index, raw in enumerate(raw_notes):
        if not isinstance(raw, dict):
            raise ValueError(f"{path}: note {index} must be an object")
        try:
            note = Note(float(raw["start"]), float(raw["end"]), int(raw["pitch"]))
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"{path}: invalid note at index {index}") from error
        if not math.isfinite(note.start) or not math.isfinite(note.end):
            raise ValueError(f"{path}: note {index} has a non-finite boundary")
        if note.start < 0 or note.end <= note.start or not 0 <= note.pitch <= 127:
            raise ValueError(f"{path}: invalid note bounds or MIDI pitch at index {index}")
        notes.append(note)
    return sorted(notes, key=lambda note: (note.start, note.pitch, note.end))


def maximum_matching(
    references: list[Note],
    predictions: list[Note],
    compatible: Callable[[Note, Note], bool],
) -> list[tuple[int, int]]:
    """Return a maximum-cardinality deterministic bipartite matching."""
    edges = [
        sorted(
            (prediction_index for prediction_index, prediction in enumerate(predictions) if compatible(reference, prediction)),
            key=lambda prediction_index: (
                abs(reference.start - predictions[prediction_index].start),
                abs(reference.end - predictions[prediction_index].end),
                abs(reference.pitch - predictions[prediction_index].pitch),
                prediction_index,
            ),
        )
        for reference in references
    ]
    prediction_to_reference: dict[int, int] = {}

    def augment(reference_index: int, visited: set[int]) -> bool:
        for prediction_index in edges[reference_index]:
            if prediction_index in visited:
                continue
            visited.add(prediction_index)
            previous = prediction_to_reference.get(prediction_index)
            if previous is None or augment(previous, visited):
                prediction_to_reference[prediction_index] = reference_index
                return True
        return False

    reference_order = sorted(range(len(references)), key=lambda index: (len(edges[index]), index))
    for reference_index in reference_order:
        augment(reference_index, set())
    return sorted((reference_index, prediction_index) for prediction_index, reference_index in prediction_to_reference.items())


def prf(match_count: int, reference_count: int, prediction_count: int) -> dict[str, float]:
    precision = match_count / prediction_count if prediction_count else float(reference_count == 0)
    recall = match_count / reference_count if reference_count else float(prediction_count == 0)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def mean(values: Iterable[float]) -> float | None:
    items = list(values)
    return sum(items) / len(items) if items else None


def beat_metrics(reference: dict, prediction: dict, tolerance: float) -> dict:
    reference_beats = [float(value) for value in reference.get("beats", [])]
    prediction_beats = [float(value) for value in prediction.get("beats", [])]
    matches = maximum_scalar_matching(reference_beats, prediction_beats, tolerance)
    result: dict[str, float | None] = {
        "beatPrecision": None,
        "beatRecall": None,
        "beatF1": None,
        "bpmAbsoluteError": None,
    }
    if reference_beats or prediction_beats:
        scores = prf(len(matches), len(reference_beats), len(prediction_beats))
        result.update({"beatPrecision": scores["precision"], "beatRecall": scores["recall"], "beatF1": scores["f1"]})
    if isinstance(reference.get("bpm"), (int, float)) and isinstance(prediction.get("bpm"), (int, float)):
        result["bpmAbsoluteError"] = abs(float(reference["bpm"]) - float(prediction["bpm"]))
    return result


def maximum_scalar_matching(references: list[float], predictions: list[float], tolerance: float) -> list[tuple[int, int]]:
    reference_notes = [Note(value, value + 0.001, 0) for value in references]
    prediction_notes = [Note(value, value + 0.001, 0) for value in predictions]
    return maximum_matching(reference_notes, prediction_notes, lambda reference, prediction: abs(reference.start - prediction.start) <= tolerance)


def evaluate_case(reference: dict, prediction: dict, tolerances: dict) -> dict:
    reference_notes = load_notes(reference, Path("reference"))
    predicted_notes = load_notes(prediction, Path("prediction"))
    onset_tolerance = float(tolerances["onsetSeconds"])

    onset_matches = maximum_matching(
        reference_notes,
        predicted_notes,
        lambda reference_note, predicted_note: reference_note.pitch == predicted_note.pitch
        and abs(reference_note.start - predicted_note.start) <= onset_tolerance,
    )
    strict_matches = maximum_matching(
        reference_notes,
        predicted_notes,
        lambda reference_note, predicted_note: reference_note.pitch == predicted_note.pitch
        and abs(reference_note.start - predicted_note.start) <= onset_tolerance
        and abs(reference_note.end - predicted_note.end)
        <= max(float(tolerances["offsetSecondsMinimum"]), float(tolerances["offsetDurationRatio"]) * reference_note.duration),
    )
    onset_scores = prf(len(onset_matches), len(reference_notes), len(predicted_notes))
    strict_scores = prf(len(strict_matches), len(reference_notes), len(predicted_notes))
    onset_pairs = [(reference_notes[reference_index], predicted_notes[prediction_index]) for reference_index, prediction_index in onset_matches]

    pitch_matches = maximum_matching(
        reference_notes,
        predicted_notes,
        lambda reference_note, predicted_note: abs(reference_note.start - predicted_note.start) <= onset_tolerance,
    )
    pitch_errors = [abs(reference_notes[reference_index].pitch - predicted_notes[prediction_index].pitch) for reference_index, prediction_index in pitch_matches]

    matched_predictions = {prediction_index for _, prediction_index in onset_matches}
    duplicates = sum(
        1
        for prediction_index, predicted_note in enumerate(predicted_notes)
        if prediction_index not in matched_predictions
        and any(reference_note.pitch == predicted_note.pitch and abs(reference_note.start - predicted_note.start) <= onset_tolerance for reference_note in reference_notes)
    )
    fragments = sum(
        max(
            0,
            sum(
                predicted_note.pitch == reference_note.pitch
                and predicted_note.start < reference_note.end
                and predicted_note.end > reference_note.start
                for predicted_note in predicted_notes
            )
            - 1,
        )
        for reference_note in reference_notes
    )

    metrics = {
        "referenceNotes": len(reference_notes),
        "predictedNotes": len(predicted_notes),
        "onsetMatches": len(onset_matches),
        "onsetOffsetMatches": len(strict_matches),
        "onsetPrecision": onset_scores["precision"],
        "onsetRecall": onset_scores["recall"],
        "onsetF1": onset_scores["f1"],
        "onsetOffsetPrecision": strict_scores["precision"],
        "onsetOffsetRecall": strict_scores["recall"],
        "onsetOffsetF1": strict_scores["f1"],
        "onsetMeanAbsoluteErrorSeconds": mean(abs(reference_note.start - predicted_note.start) for reference_note, predicted_note in onset_pairs),
        "offsetMeanAbsoluteErrorSeconds": mean(abs(reference_note.end - predicted_note.end) for reference_note, predicted_note in onset_pairs),
        "durationMeanAbsoluteErrorSeconds": mean(abs(reference_note.duration - predicted_note.duration) for reference_note, predicted_note in onset_pairs),
        "pitchMeanAbsoluteErrorSemitones": mean(pitch_errors),
        "duplicateNotes": duplicates,
        "duplicateRate": duplicates / len(predicted_notes) if predicted_notes else 0.0,
        "fragments": fragments,
        "fragmentationRate": fragments / len(reference_notes) if reference_notes else 0.0,
    }
    metrics.update(beat_metrics(reference, prediction, float(tolerances["beatSeconds"])))
    return metrics


def aggregate(cases: list[dict]) -> dict:
    reference_count = sum(case["metrics"]["referenceNotes"] for case in cases)
    prediction_count = sum(case["metrics"]["predictedNotes"] for case in cases)
    onset_matches = sum(case["metrics"]["onsetMatches"] for case in cases)
    strict_matches = sum(case["metrics"]["onsetOffsetMatches"] for case in cases)
    duplicate_count = sum(case["metrics"]["duplicateNotes"] for case in cases)
    fragment_count = sum(case["metrics"]["fragments"] for case in cases)
    onset_scores = prf(onset_matches, reference_count, prediction_count)
    strict_scores = prf(strict_matches, reference_count, prediction_count)

    def macro(metric: str) -> float | None:
        return mean(case["metrics"][metric] for case in cases if case["metrics"].get(metric) is not None)

    return {
        "caseCount": len(cases),
        "referenceNotes": reference_count,
        "predictedNotes": prediction_count,
        "onsetPrecision": onset_scores["precision"],
        "onsetRecall": onset_scores["recall"],
        "onsetF1": onset_scores["f1"],
        "onsetOffsetPrecision": strict_scores["precision"],
        "onsetOffsetRecall": strict_scores["recall"],
        "onsetOffsetF1": strict_scores["f1"],
        "duplicateRate": duplicate_count / prediction_count if prediction_count else 0.0,
        "fragmentationRate": fragment_count / reference_count if reference_count else 0.0,
        "onsetMeanAbsoluteErrorSeconds": macro("onsetMeanAbsoluteErrorSeconds"),
        "offsetMeanAbsoluteErrorSeconds": macro("offsetMeanAbsoluteErrorSeconds"),
        "durationMeanAbsoluteErrorSeconds": macro("durationMeanAbsoluteErrorSeconds"),
        "pitchMeanAbsoluteErrorSemitones": macro("pitchMeanAbsoluteErrorSemitones"),
        "beatF1": macro("beatF1"),
        "bpmAbsoluteError": macro("bpmAbsoluteError"),
        "reviewSeconds": sum(float(case.get("review", {}).get("elapsedSeconds", 0)) for case in cases),
        "editOperations": sum(int(case.get("review", {}).get("editOperations", 0)) for case in cases),
    }


def grouped(cases: list[dict], key: str) -> dict[str, dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for case in cases:
        groups[str(case.get(key, "unknown"))].append(case)
    return {name: aggregate(items) for name, items in sorted(groups.items())}


def gate_results(summary: dict, gates: dict) -> list[dict]:
    checks = [
        ("onsetF1", "minimum", gates.get("onsetF1")),
        ("onsetOffsetF1", "minimum", gates.get("onsetOffsetF1")),
        ("duplicateRate", "maximum", gates.get("duplicateRateMaximum")),
        ("fragmentationRate", "maximum", gates.get("fragmentationRateMaximum")),
    ]
    results = []
    for metric, comparison, threshold in checks:
        if threshold is None:
            continue
        actual = summary[metric]
        passed = actual >= threshold if comparison == "minimum" else actual <= threshold
        results.append({"metric": metric, "comparison": comparison, "threshold": threshold, "actual": actual, "passed": passed})
    return results


def evaluate_manifest(manifest_path: Path, policy_path: Path) -> dict:
    manifest = load_json(manifest_path)
    policy = load_json(policy_path)
    if manifest.get("schemaVersion") != 1 or policy.get("schemaVersion") != 1:
        raise ValueError("Unsupported evaluation schema version")
    base = manifest_path.parent
    cases = []
    for case in manifest.get("cases", []):
        if not isinstance(case, dict):
            raise ValueError("Manifest cases must be objects")
        reference_path = base / str(case["referencePath"])
        prediction_path = base / str(case["predictionPath"])
        reference = load_json(reference_path)
        prediction = load_json(prediction_path)
        evaluated = {**case, "metrics": evaluate_case(reference, prediction, policy["tolerances"])}
        evaluated["review"] = prediction.get("review", {})
        cases.append(evaluated)
    if not cases:
        raise ValueError("Manifest contains no evaluation cases")
    summary = aggregate(cases)
    gates = gate_results(summary, policy.get("gates", {}))
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": manifest.get("dataset", {}),
        "run": manifest.get("run", {}),
        "policy": {"name": policy.get("policy"), "tolerances": policy["tolerances"]},
        "summary": summary,
        "byInstrument": grouped(cases, "instrument"),
        "bySourceType": grouped(cases, "sourceType"),
        "gates": gates,
        "passed": all(gate["passed"] for gate in gates),
        "cases": cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--policy", type=Path, default=Path(__file__).with_name("thresholds.json"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fail-on-regression", action="store_true")
    arguments = parser.parse_args()
    try:
        report = evaluate_manifest(arguments.manifest.resolve(), arguments.policy.resolve())
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"Evaluation failed: {error}", file=sys.stderr)
        return 2
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(rendered, encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "summary": report["summary"], "gates": report["gates"]}, ensure_ascii=False, indent=2))
    return 1 if arguments.fail_on_regression and not report["passed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

