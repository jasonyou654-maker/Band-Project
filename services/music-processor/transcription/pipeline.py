"""Stage-aware orchestration for one transcription request.

This module has no FastAPI dependency. Workers can run it in-process now and
move it to a durable queue later without changing the musical pipeline.
"""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from time import perf_counter

from .adapters import BeatTracker, NoteTranscriber, SourceSeparator, pipeline_metadata
from .audio import AudioPreprocessor
from .contracts import BeatGrid, PipelineMetadata, PipelineStage, TranscriptionRequest, TranscriptionResult
from .refinement import RefinementPolicy, refine_events
from .routing import SeparationMode, TargetRouter
from .score import Music21ScoreExporter, RhythmQuantizer
from .musical_analysis import estimate_key


class TranscriptionPipeline:
    def __init__(
        self,
        *,
        preprocessor: AudioPreprocessor,
        transcriber: NoteTranscriber,
        router: TargetRouter | None = None,
        separator: SourceSeparator | None = None,
        beat_tracker: BeatTracker | None = None,
        refinement_policy: RefinementPolicy = RefinementPolicy(),
        quantizer: RhythmQuantizer | None = None,
        score_exporter: Music21ScoreExporter | None = None,
        score_artifacts_directory: Path | None = None,
    ) -> None:
        self.preprocessor = preprocessor
        self.transcriber = transcriber
        self.router = router or TargetRouter()
        self.separator = separator
        self.beat_tracker = beat_tracker
        self.refinement_policy = refinement_policy
        self.quantizer = quantizer
        self.score_exporter = score_exporter
        self.score_artifacts_directory = score_artifacts_directory

    def run(self, request: TranscriptionRequest, source_path: Path) -> TranscriptionResult:
        started = perf_counter()
        normalized = self.preprocessor.normalize(request, source_path)
        route = self.router.route(request)
        separation = None
        primary_audio = normalized
        warnings = [route.rationale]

        if request.audio.source_type != "isolated":
            if self.separator is None:
                warnings.append("No source separator is configured; transcribing the normalized mix directly.")
            else:
                separation = self.separator.separate(normalized, route.preferred_stem)
                primary_audio = separation.primary_audio
                warnings.extend(separation.warnings)

        output = self.transcriber.transcribe(primary_audio, request.target_instrument)
        refined_events, refinement = refine_events(output.raw_events, self.refinement_policy)
        if self.beat_tracker:
            event_tracker = getattr(self.beat_tracker, "track_with_events", None)
            beat_grid = event_tracker(normalized, refined_events) if event_tracker else self.beat_tracker.track(normalized)
        else:
            beat_grid = BeatGrid(bpm=request.requested_bpm)
        metadata = pipeline_metadata(output, separator=separation)
        metadata = replace(
            metadata,
            parameters={
                **metadata.parameters,
                "route": route.separation_mode.value,
                "preferredStem": route.preferred_stem,
                "durationSeconds": normalized.duration_seconds,
                "refinement": {"filteredShortEvents": refinement.filtered_short_events, "mergedEvents": refinement.merged_events},
            },
            processing_seconds=round(perf_counter() - started, 4),
        )
        warnings.extend(output.warnings)
        warnings.append(f"Refinement: filtered {refinement.filtered_short_events} weak short events and merged {refinement.merged_events} split events.")
        canonical_score = None
        midi_path = output.midi_path
        musicxml = None
        if self.quantizer and self.score_exporter and self.score_artifacts_directory and refined_events:
            # There must be exactly one notation path. Exporting Basic Pitch's
            # MIDI through music21 as a fallback silently invents a default
            # meter and metronome mark. The canonical score preserves measured
            # timing and emits free rhythm when pulse evidence is insufficient.
            canonical_score = self.quantizer.quantize(refined_events, beat_grid, request.audio.filename, request.target_instrument)
            key_evidence = estimate_key(refined_events)
            if key_evidence["key"] and key_evidence["mode"]:
                canonical_score = replace(
                    canonical_score,
                    key_signature=f"{key_evidence['key']} {key_evidence['mode']}",
                )
            exports = self.score_exporter.export(canonical_score, self.score_artifacts_directory)
            midi_path = exports.midi_path
            musicxml = exports.musicxml_path.read_text(encoding="utf-8")
            warnings.extend(canonical_score.warnings)
        elif request.strict_rhythm:
            warnings.append("Strict rhythm was requested, but the score exporter is not configured; no notation was generated.")
        return TranscriptionResult(
            request=request,
            stage=PipelineStage.COMPLETED,
            raw_events=output.raw_events,
            refined_events=refined_events,
            beat_grid=beat_grid,
            metadata=metadata,
            warnings=tuple(warnings),
            midi_base64=None,
            musicxml=musicxml,
            midi_path=midi_path,
            raw_output_path=output.raw_output_path,
            canonical_score=canonical_score,
        )
