from __future__ import annotations

from typing import Any

from app.agents.types import ScoringAgentOutput, SpeechAgentOutput, VisionAgentOutput, FusionAgentOutput
from app.pipeline.aggregate import score_from_metrics, tips_from_cards


class ScoringAgent:
    def run(self, speech: SpeechAgentOutput, vision: VisionAgentOutput, fusion: FusionAgentOutput) -> ScoringAgentOutput:
        # Reuse existing scoring rubric but allow fusion to nudge the score.
        gestures_per_min = 0.0
        if speech.speaking_sec > 0:
            gestures_per_min = float(vision.gestures.get("event_count", 0)) / (speech.speaking_sec / 60.0)

        cards: dict[str, Any] = {
            "speech_rate": {"wpm": speech.wpm, "words": speech.words, "speaking_sec": speech.speaking_sec},
            "tonal_variation": speech.tonal_variation,
            "filler_words": speech.fillers,
            "eye_contact": vision.eye_contact,
            "expressions": vision.expressions,
            "gestures": {"per_minute": gestures_per_min, "event_count": vision.gestures.get("event_count", 0)},
        }

        base_score, base_conf = score_from_metrics(cards)
        # small nudge based on engagement score
        score = int(max(0, min(100, round(0.85 * base_score + 0.15 * fusion.engagement_score))))
        tips = tips_from_cards(cards)
        confidence = base_conf
        return ScoringAgentOutput(overall_score=score, confidence=confidence, tips=tips)

