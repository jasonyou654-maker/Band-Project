#!/usr/bin/env python3
"""Download complete Slakh2100 tracks from a file-level mirror under a hard cap."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPOSITORY = "J1mmymm/MIMuT_Data_v2"
BASE_PATH = "data/Slakh2100_redux/train"
DEFAULT_TRACKS = ("Track00018", "Track00019", "Track00020", "Track00021", "Track00022")
STEM_HEADER = re.compile(r"^  (S\d+):\s*$")


def request_bytes(url: str, attempts: int = 4) -> bytes:
    curl = shutil.which("curl")
    if curl:
        result = subprocess.run(
            [curl, "--fail", "--location", "--silent", "--show-error", "--connect-timeout", "20", "--max-time", "90", "--retry", str(attempts), "--retry-all-errors", url],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            return result.stdout
        raise RuntimeError(f"Could not download {url}: {result.stderr.decode(errors='replace').strip()}")
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


def bass_stem_ids(metadata: str) -> set[str]:
    current: str | None = None
    selected: set[str] = set()
    for line in metadata.splitlines():
        match = STEM_HEADER.match(line)
        if match:
            current = match.group(1)
        elif current and line.strip() == "inst_class: Bass":
            selected.add(current)
    return selected


def select_files(files: list[dict], mode: str, endpoint: str) -> list[dict]:
    if mode == "all":
        return files
    if mode == "audio":
        return [
            item for item in files
            if item["path"].endswith("/metadata.yaml")
            or item["path"].endswith(("/mix.flac", "/mix.wav"))
            or ("/stems/" in item["path"] and item["path"].endswith((".flac", ".wav")))
        ]
    if mode != "bass":
        raise ValueError(f"Unsupported download mode: {mode}")
    metadata_item = next(item for item in files if item["path"].endswith("/metadata.yaml"))
    metadata_url = f"{endpoint}/datasets/{REPOSITORY}/resolve/main/{quote(metadata_item['path'])}?download=true"
    bass_ids = bass_stem_ids(request_bytes(metadata_url).decode("utf-8"))
    if not bass_ids:
        raise RuntimeError(f"No rendered bass stems found in {metadata_item['path']}.")
    wanted = {"metadata.yaml", "mix.flac", "mix.wav", *(f"stems/{stem_id}.flac" for stem_id in bass_ids), *(f"stems/{stem_id}.wav" for stem_id in bass_ids)}
    return [
        item for item in files
        if "/".join(item["path"].split("/")[-2:]) in wanted
        or item["path"].endswith(("/metadata.yaml", "/mix.flac", "/mix.wav"))
    ]


def download_file(url: str, output: Path, expected: int) -> int:
    partial = output.with_suffix(output.suffix + ".part")
    curl = shutil.which("curl")
    if curl:
        result = subprocess.run(
            [
                curl, "--fail", "--location", "--silent", "--show-error",
                "--connect-timeout", "20", "--max-time", "180",
                "--speed-limit", "1024", "--speed-time", "30",
                "--retry", "5", "--retry-all-errors", "--continue-at", "-",
                "--output", str(partial), url,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Could not download {url}: {result.stderr.strip()}")
    else:
        partial.write_bytes(request_bytes(url))
    actual = partial.stat().st_size
    if expected and actual != expected:
        raise RuntimeError(f"Size mismatch for {url}: {actual} != {expected}")
    partial.replace(output)
    return actual


def download_tracks(destination: Path, tracks: tuple[str, ...], max_bytes: int, endpoint: str = "https://huggingface.co", mode: str = "audio") -> dict:
    selected: list[dict] = []
    for track in tracks:
        files = tree(f"{BASE_PATH}/{track}", endpoint)
        selected.extend(select_files(files, mode, endpoint))
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
        downloaded += download_file(url, output, expected)
        if downloaded > max_bytes:
            raise RuntimeError("Downloaded bytes exceeded the configured hard limit.")
    manifest = {"source": REPOSITORY, "endpoint": endpoint, "tracks": list(tracks), "mode": mode, "bytes": downloaded, "budgetBytes": max_bytes}
    (destination / "subset-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("training/data/slakh-subset"))
    parser.add_argument("--tracks", default=",".join(DEFAULT_TRACKS))
    parser.add_argument("--max-bytes", type=int, default=750_000_000)
    parser.add_argument("--endpoint", default=os.getenv("HF_ENDPOINT", "https://huggingface.co"))
    parser.add_argument("--mode", choices=("audio", "bass", "all"), default="audio", help="audio downloads all rendered stems; bass is a smaller bass-only subset; all also includes MIDI.")
    args = parser.parse_args()
    if not 0 < args.max_bytes <= 1_000_000_000:
        raise SystemExit("--max-bytes must be between 1 and 1,000,000,000")
    tracks = tuple(value.strip() for value in args.tracks.split(",") if value.strip())
    if not tracks or any(not value.startswith("Track") for value in tracks):
        raise SystemExit("--tracks must contain TrackXXXXX identifiers")
    print(json.dumps(download_tracks(args.output, tracks, args.max_bytes, args.endpoint.rstrip("/"), mode=args.mode), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
