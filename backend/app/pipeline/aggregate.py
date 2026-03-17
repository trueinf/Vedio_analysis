from __future__ import annotations

from typing import Any


def score_from_metrics(cards: dict[str, Any]) -> tuple[int, str]:
    # Confidence-aware scoring is added later; this is a pragmatic MVP rubric.
    score = 100

    wpm = cards.get("speech_rate", {}).get("wpm")
    if isinstance(wpm, (int, float)):
        if wpm < 100 or wpm > 190:
            score -= 10
        if wpm < 80 or wpm > 220:
            score -= 10

    fillers = cards.get("filler_words", {}).get("per_minute")
    if isinstance(fillers, (int, float)):
        if fillers > 4.5:
            score -= 15
        if fillers > 7.0:
            score -= 10

    eye = cards.get("eye_contact", {}).get("on_camera_ratio")
    if isinstance(eye, (int, float)):
        if eye < 0.55:
            score -= 15
        if eye < 0.40:
            score -= 10

    gpm = cards.get("gestures", {}).get("per_minute")
    if isinstance(gpm, (int, float)):
        if gpm < 1.0:
            score -= 10

    pros = cards.get("tonal_variation", {}).get("label")
    if pros == "mostly monotone":
        score -= 10

    score = max(0, min(100, int(score)))
    confidence = "high" if score >= 75 else "medium" if score >= 55 else "low"
    return score, confidence


def tips_from_cards(cards: dict[str, Any]) -> list[str]:
    tips: list[str] = []
    fillers = cards.get("filler_words", {}).get("per_minute")
    if isinstance(fillers, (int, float)) and fillers > 4.5:
        tips.append("Reduce filler words.")
    pros = cards.get("tonal_variation", {}).get("label")
    if pros == "mostly monotone":
        tips.append("Improve tonal variation.")
    eye = cards.get("eye_contact", {}).get("on_camera_ratio")
    if isinstance(eye, (int, float)) and eye < 0.55:
        tips.append("Increase eye contact.")
    gpm = cards.get("gestures", {}).get("per_minute")
    if isinstance(gpm, (int, float)) and gpm < 1.0:
        tips.append("Use more gestures.")
    if not tips:
        tips = ["Keep a steady pace.", "Continue varying your tone.", "Maintain consistent eye contact."]
    return tips[:6]

