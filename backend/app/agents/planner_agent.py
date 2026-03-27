from __future__ import annotations


class PlannerAgent:
    """
    Lightweight planning agent that selects an execution strategy before
    running specialist agents and proposes adaptive retries when quality is low.
    """

    def initial_plan(self, *, duration_sec: int) -> dict:
        duration = max(1, int(duration_sec or 1))
        if duration >= 60 * 60:
            return {
                "speech_model": "base",
                "speech_compute_type": "int8",
                "vision_fps": 0.5,
                "vision_max_frames": 6000,
                "vision_width": 480,
                "mode": "long_video",
            }
        if duration >= 10 * 60:
            return {
                "speech_model": "base",
                "speech_compute_type": "int8",
                "vision_fps": 1.0,
                "vision_max_frames": 6000,
                "vision_width": 480,
                "mode": "mid_video",
            }
        return {
            "speech_model": None,
            "speech_compute_type": "int8",
            "vision_fps": 2.0,
            "vision_max_frames": 6000,
            "vision_width": 480,
            "mode": "short_video",
        }

    def speech_retry_plan(self, *, previous_model: str | None, words: int) -> dict:
        if words < 10:
            return {"speech_model": "medium", "speech_compute_type": "float32", "reason": "very_low_word_count"}
        if words < 50 and previous_model not in ("small", "medium", "large-v3"):
            return {"speech_model": "small", "speech_compute_type": "int8", "reason": "low_word_count"}
        return {"speech_model": previous_model, "speech_compute_type": "int8", "reason": "no_retry"}

    def vision_retry_plan(self) -> dict:
        return {
            "vision_fps": 3.0,
            "vision_max_frames": 9000,
            "vision_width": 640,
            "reason": "low_face_visibility",
        }

