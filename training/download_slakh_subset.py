#!/usr/bin/env python3
"""Download complete Slakh2100 tracks from a file-level mirror under a hard cap."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPOSITORY = "J1mmymm/MIMuT_Data_v2"
BASE_PATH = "data/Slakh2100_redux/train"
DEFAULT_TRACKS = ("Track00018", "Track00019", "Track00020", "Track00021", "Track00022")


def request_bytes(url: str, attempts: int = 4) -> bytes:
    error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urlopen(Request(url, headers={"User-Agent": "BandProject-Slakh/1.0"}), timeout=60) as response:
                return response.read()
        except (OSError, URLError) as caught:
            error = caught
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not download {url}: {error}")


def tree(path: str, endpoint: str) -> list[dict]:
    encoded = "/".join(quote(part, safe="") for part in path.split("/"))
    url = f"{endpoint}/api/datasets/{REPOSITORY}/tree/main/{encoded}?recursive=true&expand=false"
    payload = json.loads(request_bytes(url))
    return [item for item in payload if item.get("type") == "file"]


def download_tracks(destination: Path, tracks: tuple[str, ...], max_bytes: int, endpoint: str = "https://huggingface.co") -> dict:
    selected: list[dict] = []
    for track in tracks:
        selected.extend(tree(f"{BASE_PATH}/{track}", endpoint))
    total = sum(int(item.get("size") or 0) for item in selected)
    if total > max_bytes:
        raise RuntimeError(f"Refusing {total} byte subset: budget is {max_bytes} bytes.")
    downloaded = 0
    for item in selected:
        remote_path = item["path"]
        relative = Path(remote_path).relative_to(BASE_PATH)
        output = destination / relative
        expected = int(item.get("size") or 0)
        if output.is_file() and output.stat().st_size == expected:
            downloaded += expected
            continue
        output.parent.mkdir(parents=True, exist_ok=True)
        url = f"{endpoint}/datasets/{REPOSITORY}/resolve/main/{quote(remote_path)}?download=true"
        payload = request_bytes(url)
        if expected and len(payload) != expected:
            raise RuntimeError(f"Size mismatch for {remote_path}: {len(payload)} != {expected}")
        output.write_bytes(payload)
        downloaded += len(payload)
        if downloaded > max_bytes:
            raise RuntimeError("Downloaded bytes exceeded the configured hard limit.")
    manifest = {"source": REPOSITORY, "endpoint": endpoint, "tracks": list(tracks), "bytes": downloaded, "budgetBytes": max_bytes}
    (destination / "subset-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("training/data/slakh-subset"))
    parser.add_argument("--tracks", default=",".join(DEFAULT_TRACKS))
    parser.add_argument("--max-bytes", type=int, default=750_000_000)
    parser.add_argument("--endpoint", default=os.getenv("HF_ENDPOINT", "https://huggingface.co"))
    args = parser.parse_args()
    if not 0 < args.max_bytes <= 1_000_000_000:
        raise SystemExit("--max-bytes must be between 1 and 1,000,000,000")
    tracks = tuple(value.strip() for value in args.tracks.split(",") if value.strip())
    if not tracks or any(not value.startswith("Track") for value in tracks):
        raise SystemExit("--tracks must contain TrackXXXXX identifiers")
    print(json.dumps(download_tracks(args.output, tracks, args.max_bytes, args.endpoint.rstrip("/")), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
