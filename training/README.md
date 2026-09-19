# Training data handoff

This folder defines the data contract to use when authorized audio and musician-reviewed references are ready. Do not commit audio, MIDI, MusicXML, or personally identifying material here.

1. Copy `manifest.example.json` to a private location and replace sample paths with private object-storage keys.
2. Run `python3 training/validate_dataset.py path/to/manifest.json`.
3. Register only assets whose licence and contributor consent are recorded.
4. Keep `test` assets held out from every tuning and training decision.

Each reference must be authoritative MIDI or MusicXML for the same audio excerpt. Use `evaluation` until a training run is approved; record `consentedForTraining` per asset.

## BabySlakh bass refinement

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
python3 training/download_slakh_subset.py
python3 training/train_bass_mask.py --data training/data/slakh-subset --epochs 8
```

The trainer holds out the final 20% of tracks and records both training and
validation loss. A run with only one track is rejected, preventing a misleading
"trained" checkpoint with no independent validation evidence.

The compact residual-mask model is trained specifically against the summed Bass
stems. It is a conservative post-Demucs correction model; the original float32
Demucs stem remains available as the reference signal so training or denoising
never destructively replaces source audio.
