# Training data handoff

This folder defines the data contract to use when authorized audio and musician-reviewed references are ready. Do not commit audio, MIDI, MusicXML, or personally identifying material here.

1. Copy `manifest.example.json` to a private location and replace sample paths with private object-storage keys.
2. Run `python3 training/validate_dataset.py path/to/manifest.json`.
3. Register only assets whose licence and contributor consent are recorded.
4. Keep `test` assets held out from every tuning and training decision.

Each reference must be authoritative MIDI or MusicXML for the same audio excerpt. Use `evaluation` until a training run is approved; record `consentedForTraining` per asset.

## Slakh full-band refinement

BabySlakh v2 is the official 20-track prototype subset of Slakh2100. Its archive
is 882.8 MB, so it stays below the requested 1 GB download budget. The downloader
enforces the budget while streaming and verifies the official MD5 checksum.

```bash
python3 training/download_babyslakh.py --extract
python3 -m pip install -r training/requirements-slakh.txt
python3 training/train_bass_mask.py --epochs 8
```

If Zenodo is unavailable, download complete tracks individually from the
Slakh2100 Redux mirror. The default five-track subset is normally far below
750 MB and the downloader refuses to cross either its configured limit or 1 GB:

```bash
python3 training/download_slakh_subset.py --endpoint https://hf-mirror.com
python3 training/train_multistem_mask.py --data training/data/slakh-subset --epochs 8
python3 training/export_multistem_onnx.py
```

The trainer holds out the final 20% of tracks and records both training and
validation loss. A run with only one track is rejected, preventing a misleading
"trained" checkpoint with no independent validation evidence.

For training that does not depend on a laptop or Render, run the GitHub Actions
workflow **Train Slakh full-band model**. It restores a bounded dataset cache,
trains on a hosted CPU runner, rejects candidates that do not improve held-out
validation loss, verifies the exported four-stem ONNX contract, and saves the
checkpoint, metrics, logs, and ONNX model as a 14-day artifact. It never
overwrites the production model automatically.

The default subset mode downloads the mixture, metadata, and every rendered
audio stem, while skipping MIDI files that the separator does not consume. The
compact mask model learns bass, drums, vocals, and other across the full audible
range. Its spectral loss gives 0-250 Hz extra weight without removing the
midrange or high-frequency objectives. It is a conservative analysis pass; the
original float32 Demucs stems remain the reference so a small-data checkpoint
never destructively replaces exported audio.
