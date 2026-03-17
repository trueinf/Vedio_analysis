from __future__ import annotations

from app.agents.types import FusionAgentOutput, SpeechAgentOutput, VisionAgentOutput


class BehaviorFusionAgent:
    def run(self, speech: SpeechAgentOutput, vision: VisionAgentOutput) -> FusionAgentOutput:
        notes: list[str] = []

        eye = vision.eye_contact.get("on_camera_ratio")
        if vision.eye_contact.get("not_measurable"):
            notes.append("Eye contact not measurable (face not visible).")
            eye_score = 60
        elif isinstance(eye, (int, float)):
            eye_score = int(max(0, min(100, 40 + 100 * float(eye))))
        else:
            eye_score = 60

        fillers_pm = speech.fillers.get("per_minute")
        if isinstance(fillers_pm, (int, float)):
            filler_score = int(max(0, min(100, 100 - 12 * float(fillers_pm))))
        else:
            filler_score = 70

        gesture_events = vision.gestures.get("event_count", 0)
        gesture_score = 70 if isinstance(gesture_events, int) and gesture_events > 0 else 55

        engagement = int(round(0.45 * eye_score + 0.35 * gesture_score + 0.20 * filler_score))

        confidence = 80
        if vision.eye_contact.get("not_measurable"):
            confidence -= 20
        if speech.speaking_sec <= 3:
            confidence -= 20

        return FusionAgentOutput(
            engagement_score=max(0, min(100, engagement)),
            confidence_score=max(0, min(100, confidence)),
            notes=notes,
        )

