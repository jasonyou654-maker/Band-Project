# Training data handoff

This folder defines the data contract to use when authorized audio and musician-reviewed references are ready. Do not commit audio, MIDI, MusicXML, or personally identifying material here.

1. Copy `manifest.example.json` to a private location and replace sample paths with private object-storage keys.
2. Run `python3 training/validate_dataset.py path/to/manifest.json`.
3. Register only assets whose licence and contributor consent are recorded.
4. Keep `test` assets held out from every tuning and training decision.

Each reference must be authoritative MIDI or MusicXML for the same audio excerpt. Use `evaluation` until a training run is approved; record `consentedForTraining` per asset.
