# Studio17 transcription evaluation

This directory is the quality gate for audio-to-score work. It evaluates note
events before MIDI or MusicXML engraving so model quality is not confused with
notation layout quality.

## What is measured

- onset-only note precision, recall, and F1 (same MIDI pitch, onset within 50 ms)
- onset-and-offset note precision, recall, and F1
- mean onset, offset, duration, and pitch error
- duplicate-note and fragmentation rates
- optional beat F1 and BPM error
- optional human-review time and edit operations per reference note
- macro averages by instrument and source type (`isolated` or `mix`)

The default tolerances live in `thresholds.json`. These are versioned evaluation
policy, not Basic Pitch inference parameters.

## Dataset layout

Copy `manifest.example.json` and create one entry per benchmark clip. Audio may
live outside Git; paths are relative to the manifest. Each case points to:

- an immutable reference JSON reviewed by a musician;
- a prediction JSON produced by the model/pipeline under test;
- optional source audio and review metadata.

Reference and prediction files use seconds and integer MIDI pitches:

```json
{
  "notes": [
    { "start": 0.5, "end": 1.0, "pitch": 60 }
  ],
  "bpm": 120,
  "beats": [0.0, 0.5, 1.0]
}
```

Predictions returned by the current service can also use the existing
`noteEvents` key. Extra fields are ignored, which lets saved API responses be
evaluated without rewriting them.

## Running an evaluation

```bash
python3 evaluation/evaluate.py \
  --manifest evaluation/manifest.example.json \
  --output evaluation/reports/latest.json
```

Add `--fail-on-regression` to return a non-zero exit code when a configured
quality gate fails. The example manifest is only a smoke fixture; it is not a
claim about production accuracy.

Run the evaluator tests with:

```bash
python3 -m unittest discover -s evaluation/tests -p 'test_*.py'
```

## Building the real benchmark

Start with 20-30 short, legally usable clips per launch instrument. Keep clips
between 10 and 30 seconds and balance:

- isolated stems and full mixes;
- monophonic and polyphonic passages;
- slow, medium, and fast tempi;
- clean, compressed, reverberant, and noisy recordings;
- sustained notes, repeated notes, chords, syncopation, and rests.

Split by song, not by clip, into `development` and `test`; otherwise adjacent
sections of one recording can leak into both sets. The test references should
be frozen and reviewed by two musicians. Do not tune model thresholds against
the test split.

For every model run, archive the manifest version, Git commit, model version,
inference parameters, aggregate report, and per-case report. Accuracy should be
reported per instrument and source type; one global F1 can hide severe failures
on a smaller category.

The `Transcription evaluation` GitHub Actions workflow validates the metric
implementation and uploads its JSON report. Replace the smoke manifest with a
private or licensed benchmark manifest in the model deployment pipeline; raw
copyrighted audio should not be committed to this repository.
