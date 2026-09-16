#!/usr/bin/env python3
"""Validate the training/evaluation data contract without reading audio bytes."""
from __future__ import annotations
import argparse, json
from pathlib import Path

ALLOWED_SPLITS = {"train", "validation", "test"}
ALLOWED_INSTRUMENTS = {"guitar", "bass", "piano", "vocals", "drums", "chords", "lead-sheet", "auto"}
ALLOWED_SOURCE_TYPES = {"isolated", "mix"}

def validate(manifest: dict) -> list[str]:
    errors: list[str] = []
    if manifest.get("schemaVersion") != 1: errors.append("schemaVersion must be 1")
    dataset = manifest.get("dataset")
    if not isinstance(dataset, dict) or not all(isinstance(dataset.get(field), str) and dataset[field].strip() for field in ("name", "purpose", "license", "owner")): errors.append("dataset must include non-empty name, purpose, license, and owner")
    assets = manifest.get("assets")
    if not isinstance(assets, list) or not assets: return errors + ["assets must be a non-empty array"]
    identifiers: set[str] = set()
    for index, asset in enumerate(assets):
        prefix = f"assets[{index}]"
        if not isinstance(asset, dict): errors.append(f"{prefix} must be an object"); continue
        identifier = asset.get("id")
        if not isinstance(identifier, str) or not identifier.strip() or identifier in identifiers: errors.append(f"{prefix}.id must be unique and non-empty")
        else: identifiers.add(identifier)
        if asset.get("split") not in ALLOWED_SPLITS: errors.append(f"{prefix}.split is invalid")
        if asset.get("instrument") not in ALLOWED_INSTRUMENTS: errors.append(f"{prefix}.instrument is unsupported")
        if asset.get("sourceType") not in ALLOWED_SOURCE_TYPES: errors.append(f"{prefix}.sourceType must be isolated or mix")
        for field in ("audioPath", "referencePath", "license"):
            if not isinstance(asset.get(field), str) or not asset[field].strip(): errors.append(f"{prefix}.{field} must be non-empty")
        if not isinstance(asset.get("consentedForTraining"), bool): errors.append(f"{prefix}.consentedForTraining must be boolean")
    return errors

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("manifest", type=Path); args = parser.parse_args()
    try: manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error: parser.error(f"could not read manifest: {error}")
    errors = validate(manifest)
    if errors: print("Dataset manifest is invalid:\n" + "\n".join(f"- {error}" for error in errors)); return 1
    print(f"Dataset manifest is valid: {len(manifest['assets'])} asset(s)"); return 0

if __name__ == "__main__": raise SystemExit(main())
