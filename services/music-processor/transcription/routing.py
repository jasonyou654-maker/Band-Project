"""Choose source-separation policy without coupling callers to one separator."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .contracts import TargetInstrument, TranscriptionRequest


class SeparationMode(str, Enum):
    BYPASS = "bypass"
    PREFERRED_STEM = "preferred-stem"
    AUXILIARY_STEM = "auxiliary-stem"


@dataclass(frozen=True)
class TargetRoute:
    target: TargetInstrument
    separation_mode: SeparationMode
    preferred_stem: str | None
    rationale: str


class TargetRouter:
    """Conservative routing: separation is evidence, never assumed ground truth."""

    _RELIABLE_STEMS = {"vocals": "vocals", "bass": "bass", "drums": "drums"}

    def route(self, request: TranscriptionRequest) -> TargetRoute:
        if request.audio.source_type == "isolated":
            return TargetRoute(request.target_instrument, SeparationMode.BYPASS, None, "Input is declared as an isolated stem.")
        stem = self._RELIABLE_STEMS.get(request.target_instrument)
        if stem:
            return TargetRoute(request.target_instrument, SeparationMode.PREFERRED_STEM, stem, "Use the target stem as primary evidence and the mix for verification.")
        if request.target_instrument in {"piano", "guitar", "chords", "lead-sheet"}:
            return TargetRoute(request.target_instrument, SeparationMode.AUXILIARY_STEM, "other", "Do not treat generic separation as an isolated piano or guitar track.")
        return TargetRoute(request.target_instrument, SeparationMode.BYPASS, None, "No reliable target-specific stem is available.")

