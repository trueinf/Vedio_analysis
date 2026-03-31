from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class SpeechAgentOutput:
    transcript: str
    segments: list[dict[str, Any]]
    words_timed: list[dict[str, Any]]
    duration_sec: float
    low_speech_detected: bool
    wpm: float
    words: int
    speaking_sec: float
    fillers: dict[str, Any]
    tonal_variation: dict[str, Any]
    timeline_bins: list[dict[str, Any]]
    metric_events: list[dict[str, Any]]


@dataclass
class VisionAgentOutput:
    eye_contact: dict[str, Any]
    expressions: dict[str, Any]
    gestures: dict[str, Any]
    quality: dict[str, Any]
    timeline_bins: list[dict[str, Any]]
    metric_events: list[dict[str, Any]]
    speakers: list[dict[str, Any]] = None  # type: ignore[assignment]


@dataclass
class FusionAgentOutput:
    engagement_score: int
    confidence_score: int
    notes: list[str]


@dataclass
class ScoringAgentOutput:
    overall_score: int
    confidence: str
    tips: list[str]


@dataclass
class FeedbackAgentOutput:
    strengths: list[str]
    suggestions: list[str]

