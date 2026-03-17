from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.agents.feedback_agent import FeedbackAgent
from app.agents.fusion_agent import BehaviorFusionAgent
from app.agents.scoring_agent import ScoringAgent
from app.agents.speech_agent import SpeechAgent
from app.agents.vision_agent import VisionAgent
from app.models import Job


def _set_progress(db: Session, job: Job, *, stage: str, progress: float) -> None:
    job.stage = stage
    job.progress = max(0.0, min(1.0, float(progress)))
    db.commit()


class Orchestrator:
    def __init__(self) -> None:
        self.speech = SpeechAgent()
        self.vision = VisionAgent()
        self.fusion = BehaviorFusionAgent()
        self.scoring = ScoringAgent()
        self.feedback = FeedbackAgent()

    def run(self, db: Session, job: Job, *, normalized_video: str, wav_path: str) -> dict[str, Any]:
        _set_progress(db, job, stage="preprocessed", progress=0.2)

        with ThreadPoolExecutor(max_workers=2) as ex:
            f_speech = ex.submit(self.speech.run, wav_path, duration_sec=job.duration_sec)
            f_vision = ex.submit(self.vision.run, normalized_video, duration_sec=job.duration_sec)

            _set_progress(db, job, stage="running_agents", progress=0.35)
            _set_progress(db, job, stage="speech_running", progress=0.40)
            speech_out = f_speech.result()
            _set_progress(db, job, stage="speech_done", progress=0.6)
            _set_progress(db, job, stage="vision_running", progress=0.65)
            vision_out = f_vision.result()
            _set_progress(db, job, stage="vision_done", progress=0.75)

        fusion_out = self.fusion.run(speech_out, vision_out)
        _set_progress(db, job, stage="fusion_done", progress=0.82)

        scoring_out = self.scoring.run(speech_out, vision_out, fusion_out)
        _set_progress(db, job, stage="scoring_done", progress=0.90)

        feedback_out = self.feedback.run(speech_out, vision_out, fusion_out, scoring_out)
        _set_progress(db, job, stage="feedback_done", progress=0.96)

        # Consolidated result payload for the UI + storage.
        duration_sec = max(1, int(job.duration_sec or 1))
        gestures_per_min = float(vision_out.gestures.get("event_count", 0)) / (duration_sec / 60.0)

        cards: dict[str, Any] = {
            "speech_rate": {"wpm": speech_out.wpm, "words": speech_out.words, "speaking_sec": speech_out.speaking_sec},
            "tonal_variation": speech_out.tonal_variation,
            "filler_words": speech_out.fillers,
            "eye_contact": vision_out.eye_contact,
            "expressions": vision_out.expressions,
            "gestures": {
                "per_minute": gestures_per_min,
                "event_count": vision_out.gestures.get("event_count", 0),
                "types": vision_out.gestures.get("types", {}),
            },
        }

        print("[Speech] WPM:", round(float(speech_out.wpm or 0.0), 2))
        print("[Speech] Fillers:", speech_out.fillers)
        print("[Vision] EyeContact:", vision_out.eye_contact)
        print("[Vision] Gestures/min:", round(float(gestures_per_min or 0.0), 2))

        timeline = _merge_timeline(speech_out.timeline_bins, vision_out.timeline_bins, bin_size_sec=60)
        events = _events_from_timeline(timeline)

        return {
            "summary": {
                "duration_sec": job.duration_sec,
                "speakers_detected": 1,
                "overall_score": scoring_out.overall_score,
                "confidence": scoring_out.confidence,
                "warnings": (
                    ["Low speech detected. Audio may be unclear, too quiet, or mostly music/silence."]
                    if getattr(speech_out, "low_speech_detected", False)
                    else []
                ),
            },
            "cards": cards,
            "fusion": asdict(fusion_out),
            "tips": scoring_out.tips,
            "feedback": {"strengths": feedback_out.strengths, "suggestions": feedback_out.suggestions},
            "timeline": {"bin_size_sec": 60, "bins": timeline},
            "events": events,
            "quality": vision_out.quality,
            "transcript": {"text": speech_out.transcript[:20000]},
            "debug": {
                "speech_segments": speech_out.segments[:200],
                "timed_words_count": len(getattr(speech_out, "words_timed", []) or []),
                "speech_duration_sec": float(getattr(speech_out, "duration_sec", 0.0) or 0.0),
                "low_speech_detected": bool(getattr(speech_out, "low_speech_detected", False)),
            },
        }


def _merge_timeline(
    speech_bins: list[dict[str, Any]],
    vision_bins: list[dict[str, Any]],
    *,
    bin_size_sec: int,
) -> list[dict[str, Any]]:
    by_idx: dict[int, dict[str, Any]] = {}
    for b in speech_bins:
        idx = int(float(b["t0"]) // bin_size_sec)
        by_idx[idx] = {
            "t0": b["t0"],
            "t1": b["t1"],
            "wpm": b.get("wpm", 0.0),
            "fillers_per_min": b.get("fillers_per_min", 0.0),
            "eye_contact": None,
            "gestures_per_min": None,
            "expression_changes_per_min": None,
            "scene": "unknown",
        }

    for vb in vision_bins:
        idx = int(float(vb["t0"]) // bin_size_sec)
        base = by_idx.get(idx)
        if base is None:
            base = {
                "t0": vb["t0"],
                "t1": vb["t1"],
                "wpm": 0.0,
                "fillers_per_min": 0.0,
                "eye_contact": None,
                "gestures_per_min": None,
                "expression_changes_per_min": None,
                "scene": "unknown",
            }
            by_idx[idx] = base

        sampled = int(vb.get("sampled", 0) or 0)
        face_visible = int(vb.get("face_visible", 0) or 0)
        on_camera = int(vb.get("on_camera", 0) or 0)
        gesture_events = int(vb.get("gesture_events", 0) or 0)
        expr_changes = int(vb.get("expr_changes", 0) or 0)

        if face_visible <= 0:
            base["eye_contact"] = None
            # treat as slides/off-camera if very low face visibility
            base["scene"] = "slides_or_offcamera"
        else:
            base["eye_contact"] = float(on_camera) / float(face_visible)
            base["scene"] = "talking_head"

        minutes = bin_size_sec / 60.0
        base["gestures_per_min"] = float(gesture_events) / minutes
        base["expression_changes_per_min"] = float(expr_changes) / minutes

    return [by_idx[i] for i in sorted(by_idx.keys())]


def _events_from_timeline(bins: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for b in bins:
        t0 = float(b["t0"])
        if isinstance(b.get("wpm"), (int, float)) and (b["wpm"] > 200 or (0 < b["wpm"] < 95)):
            events.append({"t0": t0, "type": "pace", "severity": "warn", "message": f"Pace out of range (~{int(b['wpm'])} WPM)."})
        if isinstance(b.get("fillers_per_min"), (int, float)) and b["fillers_per_min"] > 5.0:
            events.append(
                {
                    "t0": t0,
                    "type": "fillers",
                    "severity": "warn",
                    "message": f"High filler usage (~{b['fillers_per_min']:.1f}/min).",
                }
            )
        eye = b.get("eye_contact")
        if eye is not None and isinstance(eye, (int, float)) and eye < 0.5:
            events.append({"t0": t0, "type": "eye_contact", "severity": "warn", "message": f"Low eye contact (~{int(eye*100)}%)."})
    return events[:80]

