#!/usr/bin/env python3
"""Download the official 882.8 MB BabySlakh archive with a hard 1 GB cap."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import tarfile
from urllib.request import Request, urlopen

URL = "https://zenodo.org/record/4603870/files/babyslakh_16k.tar.gz?download=1"
MD5 = "311096dc2bde7d61c97e930edbfc7f78"
MAX_BYTES = 1_000_000_000


def download(destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / "babyslakh_16k.tar.gz"
    received = archive.stat().st_size if archive.exists() else 0
    digest = hashlib.md5()
    if received:
        with archive.open("rb") as existing:
            for chunk in iter(lambda: existing.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() == MD5:
            return archive
    request = Request(URL, headers={"Range": f"bytes={received}-"} if received else {})
    with urlopen(request, timeout=60) as response, archive.open("ab" if received else "wb") as output:
        declared = response.headers.get("Content-Length")
        if declared and received + int(declared) > MAX_BYTES:
            raise RuntimeError("Refusing download: declared size exceeds the 1 GB budget.")
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            received += len(chunk)
            if received > MAX_BYTES:
                raise RuntimeError("Download exceeded the 1 GB safety limit.")
            output.write(chunk)
            digest.update(chunk)
    if digest.hexdigest() != MD5:
        raise RuntimeError(f"BabySlakh checksum mismatch: {digest.hexdigest()}")
    return archive


def extract(archive: Path, destination: Path) -> None:
    root = destination.resolve()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle.getmembers():
            if not (root / member.name).resolve().is_relative_to(root):
                raise RuntimeError(f"Unsafe archive member: {member.name}")
        bundle.extractall(destination, filter="data")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("training/data/babyslakh"))
    parser.add_argument("--extract", action="store_true")
    args = parser.parse_args()
    archive = download(args.output)
    if args.extract:
        extract(archive, args.output)
    print(archive)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
