from __future__ import annotations

import os
from typing import Any

import httpx

from app.agents.types import FeedbackAgentOutput, SpeechAgentOutput, VisionAgentOutput, FusionAgentOutput, ScoringAgentOutput


class FeedbackAgent:
    """
    LLM-backed if OPENAI_API_KEY is set; otherwise rule-based feedback.
    Keeps feedback grounded in measured metrics.
    """

    def run(
        self,
        speech: SpeechAgentOutput,
        vision: VisionAgentOutput,
        fusion: FusionAgentOutput,
        scoring: ScoringAgentOutput,
    ) -> FeedbackAgentOutput:
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            try:
                return self._run_openai(api_key, speech, vision, fusion, scoring)
            except Exception:
                # fall back
                pass
        return self._run_rules(speech, vision, fusion, scoring)

    def _run_rules(
        self,
        speech: SpeechAgentOutput,
        vision: VisionAgentOutput,
        fusion: FusionAgentOutput,
        scoring: ScoringAgentOutput,
    ) -> FeedbackAgentOutput:
        strengths: list[str] = []
        suggestions: list[str] = []

        if 120 <= speech.wpm <= 180:
            strengths.append(f"Good pacing ({round(speech.wpm)} WPM).")
        elif speech.wpm > 0:
            suggestions.append(f"Adjust pacing (currently ~{round(speech.wpm)} WPM).")

        fillers_pm = speech.fillers.get("per_minute")
        if isinstance(fillers_pm, (int, float)):
            if fillers_pm <= 3.0:
                strengths.append(f"Low filler usage ({fillers_pm:.1f}/min).")
            else:
                suggestions.append(f"Reduce filler words ({fillers_pm:.1f}/min).")

        eye = vision.eye_contact.get("on_camera_ratio")
        if vision.eye_contact.get("not_measurable"):
            suggestions.append("Eye contact couldn't be measured (face not visible consistently).")
        elif isinstance(eye, (int, float)):
            if eye >= 0.65:
                strengths.append(f"Strong eye contact (~{int(eye*100)}%).")
            else:
                suggestions.append(f"Increase eye contact (~{int(eye*100)}%).")

        if speech.tonal_variation.get("label") == "mostly monotone":
            suggestions.append("Add more tonal variation during key points.")
        else:
            strengths.append("Tone shows some variation.")

        if fusion.engagement_score >= 70:
            strengths.append(f"Overall engagement looks good (score {fusion.engagement_score}).")
        else:
            suggestions.append("Improve engagement with clearer emphasis and more intentional gestures.")

        strengths = strengths[:3] or ["Solid baseline delivery."]
        suggestions = suggestions[:5] or ["Keep practicing and review key sections for clarity."]
        return FeedbackAgentOutput(strengths=strengths, suggestions=suggestions)

    def _run_openai(
        self,
        api_key: str,
        speech: SpeechAgentOutput,
        vision: VisionAgentOutput,
        fusion: FusionAgentOutput,
        scoring: ScoringAgentOutput,
    ) -> FeedbackAgentOutput:
        # Minimal OpenAI-compatible call (no extra deps). Works with OpenAI Responses API style endpoints if you proxy.
        # If you use OpenAI directly, set OPENAI_BASE_URL if needed; otherwise defaults to api.openai.com.
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a video performance coach. Only use provided metrics. "
                        "If a metric is not measurable, say so."
                    ),
                },
                {
                    "role": "user",
                    "content": {
                        "speech": {
                            "wpm": speech.wpm,
                            "fillers_per_min": speech.fillers.get("per_minute"),
                            "tonal_variation": speech.tonal_variation,
                        },
                        "vision": {
                            "eye_contact": vision.eye_contact,
                            "expressions": vision.expressions,
                            "gestures": vision.gestures,
                        },
                        "fusion": {
                            "engagement_score": fusion.engagement_score,
                            "confidence_score": fusion.confidence_score,
                            "notes": fusion.notes,
                        },
                        "scoring": {
                            "overall_score": scoring.overall_score,
                            "confidence": scoring.confidence,
                            "tips": scoring.tips,
                        },
                        "format": {
                            "strengths": "3 bullet strings",
                            "suggestions": "5 bullet strings",
                        },
                    },
                },
            ],
            "temperature": 0.4,
        }

        headers = {"Authorization": f"Bearer {api_key}"}
        with httpx.Client(timeout=20.0) as client:
            r = client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
            text = data["choices"][0]["message"]["content"]

        # Very small parser: expect lines starting with '-' for strengths then suggestions.
        # If parse fails, return the whole content as suggestions.
        lines = [ln.strip() for ln in str(text).splitlines() if ln.strip()]
        bullets = [ln[1:].strip() if ln.startswith("-") else ln for ln in lines]
        strengths = bullets[:3]
        suggestions = bullets[3:8] if len(bullets) >= 8 else bullets[3:]
        return FeedbackAgentOutput(
            strengths=strengths or ["Good effort overall."],
            suggestions=suggestions or ["Review the feedback output formatting."],
        )

