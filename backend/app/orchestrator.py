from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
import subprocess
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.agents.feedback_agent import FeedbackAgent
from app.agents.fusion_agent import BehaviorFusionAgent
from app.agents.planner_agent import PlannerAgent
from app.agents.scoring_agent import ScoringAgent
from app.agents.speech_agent import SpeechAgent
from app.agents.vision_agent import VisionAgent
from app.models import Job
from app.settings import settings
from app.utils.files import ensure_dir


def _set_progress(db: Session, job: Job, *, stage: str, progress: float) -> None:
    job.stage = stage
    job.progress = max(0.0, min(1.0, float(progress)))
    db.commit()


def _merge_metric_events(events: list[dict[str, Any]], gap_sec: float = 1.0) -> list[dict[str, Any]]:
    if not events:
        return []
    events = sorted(events, key=lambda e: float(e.get("t0", 0.0)))
    out: list[dict[str, Any]] = []
    cur = dict(events[0])
    for e in events[1:]:
        same_key = cur.get("metric") == e.get("metric") and cur.get("label") == e.get("label")
        if same_key and float(e.get("t0", 0.0)) - float(cur.get("t1", 0.0)) <= gap_sec:
            cur["t1"] = max(float(cur.get("t1", 0.0)), float(e.get("t1", 0.0)))
            continue
        out.append(cur)
        cur = dict(e)
    out.append(cur)
    return out


def _event_negative_score(e: dict[str, Any]) -> float:
    metric = str(e.get("metric") or e.get("type") or "")
    label = str(e.get("label") or "").lower()
    value = float(e.get("value") or 0.0)
    if metric == "eye_contact" and label == "low":
        return 3.0
    if metric == "filler_words":
        return 2.5
    if metric == "speech_rate" and label in ("slow", "fast"):
        return 2.0 + (0.3 if value > 180 or (0 < value < 85) else 0.0)
    if metric == "tonal_variation" and label == "monotone":
        return 2.2
    return 0.0


def _coach_comment_for_event(e: dict[str, Any]) -> str:
    metric = str(e.get("metric") or e.get("type") or "")
    label = str(e.get("label") or "").lower()
    if metric == "eye_contact" and label == "low":
        return "Maintain eye contact here."
    if metric == "filler_words":
        return "Reduce filler words here."
    if metric == "speech_rate" and label in ("slow", "fast"):
        return f"Adjust speech pace ({label}) in this segment."
    if metric == "tonal_variation" and label == "monotone":
        return "Add vocal variation here."
    if metric == "gestures":
        return "Use purposeful gestures on key points."
    if metric == "expression_change":
        return "Keep facial expression aligned with message tone."
    return "Improve delivery in this segment."


def _metric_impact_text(metric: str) -> str:
    if metric == "eye_contact":
        return "Reduced audience trust and engagement."
    if metric == "filler_words":
        return "Lowered clarity and confidence."
    if metric == "speech_rate":
        return "Made message harder to follow."
    if metric == "tonal_variation":
        return "Delivery felt flat and less engaging."
    if metric == "gestures":
        return "Lowered visual emphasis and communication impact."
    if metric == "expression_change":
        return "Reduced emotional clarity."
    return "Reduced communication impact."


def _extract_clip(
    *,
    video_path: str,
    out_path: str,
    t0: float,
    t1: float,
) -> bool:
    start = max(0.0, float(t0))
    end = max(start + 0.3, float(t1))
    cmd = [
        settings.ffmpeg_bin,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        video_path,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        out_path,
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return Path(out_path).exists()
    except Exception:
        return False


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def _engagement_windows(
    timeline_bins: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    tonal_events = [e for e in events if str(e.get("metric")) == "tonal_variation"]
    out: list[dict[str, Any]] = []
    for b in timeline_bins:
        t0 = float(b.get("t0", 0.0))
        t1 = float(b.get("t1", t0))
        # eye_contact is None when the presenter is not on screen in this bin
        # (e.g. intro card / slides). Distinguish "off-camera" from genuinely
        # low eye contact so we don't penalize engagement for it.
        eye_raw = b.get("eye_contact")
        presenter_on_screen = isinstance(eye_raw, (int, float)) and str(b.get("scene") or "") != "slides_or_offcamera"
        gestures_pm = float(b.get("gestures_per_min") or 0.0)
        fillers_pm = float(b.get("fillers_per_min") or 0.0)

        overlap_tonal: list[float] = []
        for te in tonal_events:
            e0 = float(te.get("t0", 0.0))
            e1 = float(te.get("t1", e0))
            if e1 < t0 or e0 > t1:
                continue
            if isinstance(te.get("value"), (int, float)):
                overlap_tonal.append(float(te["value"]))
        tonal_std = sum(overlap_tonal) / len(overlap_tonal) if overlap_tonal else 0.0

        eye_score = _clamp01(float(eye_raw)) if presenter_on_screen else 0.0
        tone_score = _clamp01(tonal_std / 60.0)
        gesture_score = _clamp01(gestures_pm / 4.0)
        filler_penalty = _clamp01(fillers_pm / 5.0)

        if presenter_on_screen:
            engagement = (eye_score * 0.3) + (tone_score * 0.3) + (gesture_score * 0.2) - (filler_penalty * 0.2)
        else:
            # Presenter off-screen: eye contact does not apply. Redistribute its
            # weight onto tone + gestures instead of scoring eye contact as 0.
            engagement = (tone_score * 0.45) + (gesture_score * 0.35) - (filler_penalty * 0.2)
        engagement = _clamp01(engagement)
        out.append(
            {
                "t0": t0,
                "t1": t1,
                "eye_score": eye_score,
                "tone_score": tone_score,
                "gesture_score": gesture_score,
                "filler_penalty": filler_penalty,
                "engagement_score": engagement,
                "presenter_on_screen": presenter_on_screen,
            }
        )
    return out


def _merge_drop_events(events: list[dict[str, Any]], gap_sec: float = 2.0) -> list[dict[str, Any]]:
    if not events:
        return []
    events = sorted(events, key=lambda e: float(e["t0"]))
    merged: list[dict[str, Any]] = []
    cur = dict(events[0])
    for e in events[1:]:
        if float(e["t0"]) - float(cur["t1"]) <= gap_sec:
            cur["t1"] = max(float(cur["t1"]), float(e["t1"]))
            cur["value"] = min(float(cur.get("value", 1.0)), float(e.get("value", 1.0)))
            continue
        merged.append(cur)
        cur = dict(e)
    merged.append(cur)
    return merged


def _merge_time_events(events: list[dict[str, Any]], gap_sec: float = 1.0) -> list[dict[str, Any]]:
    if not events:
        return []
    events = sorted(events, key=lambda e: float(e.get("t0", 0.0)))
    out: list[dict[str, Any]] = []
    cur = dict(events[0])
    for e in events[1:]:
        same_metric = str(cur.get("metric")) == str(e.get("metric"))
        same_label = str(cur.get("label")) == str(e.get("label"))
        if same_metric and same_label and float(e.get("t0", 0.0)) - float(cur.get("t1", 0.0)) <= gap_sec:
            cur["t1"] = max(float(cur.get("t1", 0.0)), float(e.get("t1", 0.0)))
            if isinstance(cur.get("value"), (int, float)) and isinstance(e.get("value"), (int, float)):
                cur["value"] = float((float(cur["value"]) + float(e["value"])) / 2.0)
            continue
        out.append(cur)
        cur = dict(e)
    out.append(cur)
    return out


def _insight_scores(
    *,
    eye_contact_ratio: float,
    filler_per_min: float,
    gestures_per_min: float,
    tonal_variation: float,
    expression_changes_per_min: float,
) -> tuple[int, int]:
    confidence = (
        (_clamp01(eye_contact_ratio) * 40.0)
        + ((1.0 - _clamp01(filler_per_min / 5.0)) * 30.0)
        + (_clamp01(gestures_per_min / 4.0) * 30.0)
    )
    energy = (
        (_clamp01(tonal_variation / 60.0) * 40.0)
        + (_clamp01(gestures_per_min / 4.0) * 30.0)
        + (_clamp01(expression_changes_per_min / 5.0) * 30.0)
    )
    return int(round(max(0.0, min(100.0, confidence)))), int(round(max(0.0, min(100.0, energy))))


def _pause_events(words_timed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pauses: list[dict[str, Any]] = []
    if not words_timed:
        return pauses
    words = sorted(words_timed, key=lambda w: float(w.get("start", 0.0)))
    for i in range(len(words) - 1):
        cur_end = float(words[i].get("end", words[i].get("start", 0.0)))
        nxt_start = float(words[i + 1].get("start", cur_end))
        gap = nxt_start - cur_end
        if gap > 1.0:
            pauses.append(
                {
                    "metric": "pause",
                    "label": "long_pause",
                    "t0": cur_end,
                    "t1": nxt_start,
                    "value": round(gap, 3),
                    "note": "Long pause detected",
                    "type": "pause",
                    "message": f"Long pause ({gap:.1f}s)",
                }
            )
    return _merge_time_events(pauses, gap_sec=0.5)


def _fmt_metric_name(metric: str) -> str:
    names = {
        "speech_rate": "Speech Rate",
        "filler_words": "Filler Words",
        "eye_contact": "Eye Contact",
        "gestures": "Gestures",
        "tonal_variation": "Tonal Variation",
        "expression_change": "Expressions",
    }
    return names.get(metric, metric.replace("_", " ").title())


def _metric_score_breakdown(cards: dict[str, Any], *, expr_pm: float) -> list[dict[str, Any]]:
    eye_ratio = float((cards.get("eye_contact", {}) or {}).get("on_camera_ratio") or 0.0)
    filler_pm = float((cards.get("filler_words", {}) or {}).get("per_minute") or 0.0)
    wpm = float((cards.get("speech_rate", {}) or {}).get("wpm") or 0.0)
    tonal = float((cards.get("tonal_variation", {}) or {}).get("score") or 0.0)
    gestures_pm = float((cards.get("gestures", {}) or {}).get("per_minute") or 0.0)

    parts: list[dict[str, Any]] = []
    eye_penalty = int(round((1.0 - _clamp01(eye_ratio)) * 20.0))
    parts.append({"metric": "eye_contact", "label": "Eye contact", "delta": -eye_penalty, "reason": "Low camera-facing ratio."})
    filler_penalty = int(round(_clamp01(filler_pm / 5.0) * 15.0))
    parts.append({"metric": "filler_words", "label": "Filler words", "delta": -filler_penalty, "reason": "Frequent fillers reduce clarity."})
    pace_penalty = int(round(10.0 if (0 < wpm < 95 or wpm > 160) else 0.0))
    parts.append({"metric": "speech_rate", "label": "Speech pace", "delta": -pace_penalty, "reason": "Pace outside ideal range."})
    tonal_penalty = int(round(_clamp01(max(0.0, 60.0 - tonal) / 60.0) * 10.0))
    parts.append({"metric": "tonal_variation", "label": "Tonal variation", "delta": -tonal_penalty, "reason": "Limited pitch variation."})
    expr_penalty = int(round(_clamp01(max(0.0, 1.5 - expr_pm) / 1.5) * 10.0))
    parts.append({"metric": "expression_change", "label": "Expressions", "delta": -expr_penalty, "reason": "Low expression dynamics."})
    gesture_penalty = int(round(_clamp01(max(0.0, 2.0 - gestures_pm) / 2.0) * 8.0))
    parts.append({"metric": "gestures", "label": "Gestures", "delta": -gesture_penalty, "reason": "Few purposeful gesture events."})
    return sorted(parts, key=lambda x: x["delta"])


def _select_metric_events(events: list[dict[str, Any]], metric: str, limit: int = 3) -> list[dict[str, Any]]:
    target = {"expression_change": "expression_change"}.get(metric, metric)
    out = [e for e in events if str(e.get("metric") or e.get("type") or "") == target]
    out = sorted(out, key=lambda e: float(e.get("t0", 0.0)))
    return out[:limit]


def _story_for_metric(
    *,
    metric: str,
    cards: dict[str, Any],
    events: list[dict[str, Any]],
    expr_pm: float,
) -> dict[str, Any]:
    if metric == "eye_contact":
        score = int(round(_clamp01(float((cards.get("eye_contact", {}) or {}).get("on_camera_ratio") or 0.0)) * 100.0))
        insight = "You are not maintaining enough eye contact." if score < 50 else "Your eye contact is fairly stable."
        impact = "Low eye contact can reduce trust and audience connection."
        cause = "Gaze often shifts away from camera during explanation."
        actions = ["Look at camera at sentence endings.", "Place notes closer to webcam."]
    elif metric == "filler_words":
        pm = float((cards.get("filler_words", {}) or {}).get("per_minute") or 0.0)
        score = int(round((1.0 - _clamp01(pm / 6.0)) * 100.0))
        insight = "Filler usage is affecting fluency." if pm > 3 else "Filler usage is under control."
        impact = "Frequent fillers weaken clarity and confidence."
        cause = "Hesitation words appear during transitions and thinking pauses."
        actions = ["Replace fillers with short silence.", "Slow down before key points."]
    elif metric == "speech_rate":
        wpm = float((cards.get("speech_rate", {}) or {}).get("wpm") or 0.0)
        pace_ok = 95 <= wpm <= 160
        score = int(round(max(0.0, 100.0 - abs((wpm - 130.0) / 1.8))))
        insight = "Speech pace is outside the optimal range." if not pace_ok else "Speech pace is within a strong range."
        impact = "Pace mismatch can reduce comprehension and emphasis."
        cause = "Delivery speeds up or slows down around transitions."
        actions = ["Target 95-160 WPM.", "Add deliberate pauses after key points."]
    elif metric == "tonal_variation":
        tv = float((cards.get("tonal_variation", {}) or {}).get("score") or 0.0)
        score = int(round(_clamp01(tv / 60.0) * 100.0))
        insight = "Tone sounds monotone in parts." if tv < 25 else "Tone has good variation."
        impact = "Flat tone lowers engagement and message impact."
        cause = "Pitch variation stays narrow during important statements."
        actions = ["Emphasize key words with pitch change.", "Vary intonation between sections."]
    elif metric == "expression_change":
        score = int(round(_clamp01(expr_pm / 3.5) * 100.0))
        insight = "Facial expression changes are limited." if expr_pm < 1.5 else "Expression dynamics are balanced."
        impact = "Limited expressions can make delivery feel less engaging."
        cause = "Expression remains neutral across multiple points."
        actions = ["Use expression shifts to match message.", "Add visible emphasis on key moments."]
    else:
        gp = float((cards.get("gestures", {}) or {}).get("per_minute") or 0.0)
        score = int(round(_clamp01(gp / 4.0) * 100.0))
        insight = "Gestures are missing or unclear in key moments." if gp < 2 else "Gestures are generally supportive."
        impact = "Weak gesture usage reduces delivery impact."
        cause = "Hand movement is inconsistent or off-frame."
        actions = ["Use one intentional gesture per key idea.", "Keep gestures visible at chest level."]

    ev = _select_metric_events(events, metric, limit=3)
    evidence = []
    for e in ev:
        t0 = float(e.get("t0", 0.0))
        t1 = float(e.get("t1", t0 + 0.5))
        desc = str(e.get("note") or e.get("message") or f"{_fmt_metric_name(metric)} issue")
        evidence.append(
            {
                "start": round(t0, 3),
                "end": round(t1, 3),
                "description": desc,
                "impact": impact,
                "why_problem": "This pattern lowers communication effectiveness.",
            }
        )
    # When no real issue segment exists, return no evidence rather than a
    # fabricated 0:00-0:00 entry (which surfaced as a misleading event at 0:00).

    return {
        "metric": metric,
        "score": max(0, min(100, int(score))),
        "title": f"{_fmt_metric_name(metric)} ({max(0, min(100, int(score)))}%)",
        "insight": insight,
        "impact": impact,
        "cause": cause,
        "evidence": evidence,
        "actions": actions[:3],
    }


def _coach_summary_payload(
    *,
    score_breakdown: list[dict[str, Any]],
    confidence_score: int,
    energy_score: int,
) -> dict[str, Any]:
    top = [x for x in score_breakdown if int(x.get("delta", 0)) < 0][:3]
    priorities = [
        {
            "rank": i + 1,
            "metric": str(t.get("metric", "")),
            "title": f"Improve {_fmt_metric_name(str(t.get('metric', '')))}",
            "reason": str(t.get("reason", "")),
        }
        for i, t in enumerate(top)
    ]
    lines = []
    if confidence_score >= 70:
        lines.append("You project solid confidence overall.")
    else:
        lines.append("Your confidence signal is moderate and can improve with a few focused fixes.")
    if energy_score >= 70:
        lines.append("Your delivery energy is a strength.")
    else:
        lines.append("Energy dips are reducing impact in parts of the video.")
    if top:
        lines.append(f"Highest impact fix: {_fmt_metric_name(str(top[0].get('metric', '')))}.")
    return {
        "overall": " ".join(lines[:3]),
        "top_priorities": priorities,
        "confidence_explanation": (
            f"Confidence score is {confidence_score}/100, derived from eye contact, filler control, and gesture consistency."
        ),
    }


class Orchestrator:
    def __init__(self) -> None:
        self.planner = PlannerAgent()
        self.speech = SpeechAgent()
        self.vision = VisionAgent()
        self.fusion = BehaviorFusionAgent()
        self.scoring = ScoringAgent()
        self.feedback = FeedbackAgent()

    def run(self, db: Session, job: Job, *, normalized_video: str, wav_path: str) -> dict[str, Any]:
        _set_progress(db, job, stage="preprocessed", progress=0.2)
        agent_trace: list[dict[str, Any]] = []
        plan = self.planner.initial_plan(duration_sec=int(job.duration_sec or 0))
        agent_trace.append({"agent": "planner", "step": "initial_plan", "plan": plan})

        with ThreadPoolExecutor(max_workers=2) as ex:
            f_speech = ex.submit(
                self.speech.run,
                wav_path,
                duration_sec=job.duration_sec,
                model_override=plan.get("speech_model"),
                compute_type_override=plan.get("speech_compute_type"),
            )
            f_vision = ex.submit(
                self.vision.run,
                normalized_video,
                duration_sec=job.duration_sec,
                target_fps_override=plan.get("vision_fps"),
                max_frames_override=plan.get("vision_max_frames"),
                width_override=plan.get("vision_width"),
            )

            _set_progress(db, job, stage="running_agents", progress=0.35)
            _set_progress(db, job, stage="speech_running", progress=0.40)
            speech_out = f_speech.result()
            _set_progress(db, job, stage="speech_done", progress=0.6)
            _set_progress(db, job, stage="vision_running", progress=0.65)
            vision_out = f_vision.result()
            _set_progress(db, job, stage="vision_done", progress=0.75)

        speech_retry_needed = bool(getattr(speech_out, "low_speech_detected", False) or int(getattr(speech_out, "words", 0) or 0) < 20)
        if speech_retry_needed:
            speech_retry = self.planner.speech_retry_plan(
                previous_model=plan.get("speech_model"),
                words=int(getattr(speech_out, "words", 0) or 0),
            )
            agent_trace.append({"agent": "planner", "step": "speech_retry_plan", "plan": speech_retry})
            if speech_retry.get("reason") != "no_retry":
                _set_progress(db, job, stage="speech_retry", progress=0.7)
                speech_out = self.speech.run(
                    wav_path,
                    duration_sec=job.duration_sec,
                    model_override=speech_retry.get("speech_model"),
                    compute_type_override=speech_retry.get("speech_compute_type"),
                )
                agent_trace.append(
                    {
                        "agent": "speech",
                        "step": "retry",
                        "reason": speech_retry.get("reason"),
                        "model": speech_retry.get("speech_model"),
                        "words": int(getattr(speech_out, "words", 0) or 0),
                    }
                )

        vision_retry_needed = bool((vision_out.eye_contact or {}).get("not_measurable") or float((vision_out.quality or {}).get("face_visible_ratio", 0.0) or 0.0) < 0.05)
        if vision_retry_needed:
            vision_retry = self.planner.vision_retry_plan()
            agent_trace.append({"agent": "planner", "step": "vision_retry_plan", "plan": vision_retry})
            _set_progress(db, job, stage="vision_retry", progress=0.73)
            vision_out = self.vision.run(
                normalized_video,
                duration_sec=job.duration_sec,
                target_fps_override=vision_retry.get("vision_fps"),
                max_frames_override=vision_retry.get("vision_max_frames"),
                width_override=vision_retry.get("vision_width"),
            )
            agent_trace.append(
                {
                    "agent": "vision",
                    "step": "retry",
                    "reason": vision_retry.get("reason"),
                    "face_visible_ratio": float((vision_out.quality or {}).get("face_visible_ratio", 0.0) or 0.0),
                }
            )

        fusion_out = self.fusion.run(speech_out, vision_out)
        agent_trace.append(
            {
                "agent": "fusion",
                "step": "run",
                "engagement_score": int(getattr(fusion_out, "engagement_score", 0) or 0),
                "confidence_score": int(getattr(fusion_out, "confidence_score", 0) or 0),
            }
        )
        _set_progress(db, job, stage="fusion_done", progress=0.82)

        scoring_out = self.scoring.run(speech_out, vision_out, fusion_out)
        agent_trace.append(
            {
                "agent": "scoring",
                "step": "run",
                "overall_score": int(getattr(scoring_out, "overall_score", 0) or 0),
            }
        )
        _set_progress(db, job, stage="scoring_done", progress=0.90)

        feedback_out = self.feedback.run(speech_out, vision_out, fusion_out, scoring_out)
        agent_trace.append(
            {
                "agent": "feedback",
                "step": "run",
                "strengths": len(getattr(feedback_out, "strengths", []) or []),
                "suggestions": len(getattr(feedback_out, "suggestions", []) or []),
            }
        )
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

        timeline = _merge_timeline(speech_out.timeline_bins, vision_out.timeline_bins, bin_size_sec=10)
        alerts = _events_from_timeline(timeline)
        events = _merge_metric_events(
            list(getattr(speech_out, "metric_events", []) or [])
            + list(getattr(vision_out, "metric_events", []) or []),
            gap_sec=1.0,
        )[:100]
        engagement_windows = _engagement_windows(timeline, events)
        engagement_drop_events: list[dict[str, Any]] = []
        for w in engagement_windows:
            if not w.get("presenter_on_screen", True):
                # No presenter on screen → not an engagement issue to flag.
                continue
            if float(w["engagement_score"]) < 0.4:
                engagement_drop_events.append(
                    {
                        "metric": "engagement_drop",
                        "label": "low",
                        "t0": float(w["t0"]),
                        "t1": float(w["t1"]),
                        "value": float(round(float(w["engagement_score"]), 3)),
                        "note": "Low engagement due to eye contact / tone / fillers",
                        "type": "engagement_drop",
                        "message": "Low engagement (eye contact + tone + fillers)",
                    }
                )
        engagement_drop_events = _merge_drop_events(engagement_drop_events, gap_sec=2.0)
        # Best moments: high engagement + strong supporting signals.
        best_moments = sorted(
            [
                {
                    "metric": "best_moment",
                    "label": "strong",
                    "t0": float(w["t0"]),
                    "t1": float(w["t1"]),
                    "value": float(round(float(w["engagement_score"]), 3)),
                    "note": "Strong delivery with high engagement",
                    "type": "best_moment",
                    "message": "Strong delivery with high engagement",
                }
                for w in engagement_windows
                if float(w["engagement_score"]) > 0.7
                and float(w["eye_score"]) > 0.6
                and float(w["tone_score"]) > 0.6
                and float(w["gesture_score"]) > 0.5
            ],
            key=lambda x: float(x.get("value", 0.0)),
            reverse=True,
        )[:5]
        best_moments = _merge_time_events(best_moments, gap_sec=2.0)[:5]

        # Refined worst moments from lowest engagement windows.
        worst_rank = sorted(engagement_windows, key=lambda w: float(w["engagement_score"]))
        refined_worst = []
        for w in worst_rank:
            if not w.get("presenter_on_screen", True):
                continue
            if float(w["engagement_score"]) >= 0.4:
                continue
            refined_worst.append(
                {
                    "metric": "worst_moment",
                    "label": "weak",
                    "t0": float(w["t0"]),
                    "t1": float(w["t1"]),
                    "value": float(round(float(w["engagement_score"]), 3)),
                    "note": "Low engagement due to eye contact + tone",
                    "type": "worst_moment",
                    "message": "Low engagement due to eye contact + tone",
                }
            )
        refined_worst = _merge_time_events(refined_worst, gap_sec=2.0)[:3]

        pauses = _pause_events(list(getattr(speech_out, "words_timed", []) or []))[:5]
        events = _merge_metric_events(events + engagement_drop_events + best_moments + refined_worst + pauses, gap_sec=1.0)[:100]
        ranked_negative = sorted(
            [e for e in events if _event_negative_score(e) > 0],
            key=_event_negative_score,
            reverse=True,
        )
        worst_moments: list[dict[str, Any]] = []
        for e in ranked_negative:
            if len(worst_moments) >= 5:
                break
            t0 = float(e.get("t0", 0.0))
            t1_raw = e.get("t1")
            t1 = float(t1_raw) if isinstance(t1_raw, (int, float)) else (t0 + 6.0)
            if t1 - t0 < 5.0:
                t1 = t0 + 5.0
            if t1 - t0 > 10.0:
                t1 = t0 + 10.0
            reason = str(e.get("note") or e.get("message") or f"{e.get('metric','event')} issue")
            m = str(e.get("metric") or e.get("type") or "event")
            worst_moments.append(
                {
                    "t0": round(t0, 3),
                    "t1": round(t1, 3),
                    "reason": reason,
                    "metric": m,
                    "impact": _metric_impact_text(m),
                    "label": f"Issue in {_fmt_metric_name(m)}",
                }
            )

        coach_comments: list[dict[str, Any]] = []
        # prioritize refined weakest sections and known issue events
        for e in (refined_worst + engagement_drop_events + pauses + ranked_negative):
            metric = str(e.get("metric") or e.get("type") or "")
            label = str(e.get("label") or "").lower()
            if metric in ("worst_moment", "engagement_drop"):
                msg = "You looked away during explanation — this reduces trust."
            elif metric == "filler_words":
                msg = "Frequent filler words weaken clarity."
            elif metric == "tonal_variation" and label == "monotone":
                msg = "Tone is flat — vary pitch to maintain engagement."
            elif metric == "pause":
                msg = "Long pause detected — consider tightening this transition."
            else:
                msg = _coach_comment_for_event(e)
            coach_comments.append({"metric": metric, "t0": float(e.get("t0", 0.0)), "comment": msg})
            if len(coach_comments) >= 25:
                break
        # de-dup by (metric,t0)
        seen: set[tuple[str, int]] = set()
        deduped_comments: list[dict[str, Any]] = []
        for c in coach_comments:
            key = (str(c.get("metric", "")), int(float(c.get("t0", 0.0)) * 10))
            if key in seen:
                continue
            seen.add(key)
            deduped_comments.append(c)
        coach_comments = deduped_comments
        coach_comment_events = [
            {
                "metric": "coach_comment",
                "label": "insight",
                "t0": float(c.get("t0", 0.0)),
                "t1": float(c.get("t0", 0.0)),
                "note": str(c.get("comment", "")),
                "type": "coach_comment",
                "message": str(c.get("comment", "")),
            }
            for c in coach_comments[:25]
        ]
        events = _merge_metric_events(events + coach_comment_events, gap_sec=0.5)[:100]

        clips: list[dict[str, Any]] = []
        if worst_moments:
            job_clips_dir = Path(settings.clips_dir) / job.id
            ensure_dir(job_clips_dir)
            for i, wm in enumerate(worst_moments):
                clip_name = f"clip_{i+1:02d}.mp4"
                clip_path = job_clips_dir / clip_name
                ok = _extract_clip(
                    video_path=normalized_video,
                    out_path=str(clip_path),
                    t0=float(wm["t0"]),
                    t1=float(wm["t1"]),
                )
                if ok:
                    clips.append(
                        {
                            "t0": wm["t0"],
                            "t1": wm["t1"],
                            "url": f"/api/clips/{job.id}/{clip_name}",
                            "label": wm.get("label", "Issue clip"),
                            "reason": wm.get("reason", ""),
                            "impact": wm.get("impact", ""),
                        }
                    )

        eye_ratio = float((cards.get("eye_contact", {}) or {}).get("on_camera_ratio") or 0.0)
        filler_pm = float((cards.get("filler_words", {}) or {}).get("per_minute") or 0.0)
        tonal_std = float((cards.get("tonal_variation", {}) or {}).get("score") or 0.0)
        expr_pm = 0.0
        if timeline:
            expr_vals = [float(b.get("expression_changes_per_min") or 0.0) for b in timeline]
            expr_pm = (sum(expr_vals) / len(expr_vals)) if expr_vals else 0.0
        confidence_score, energy_score = _insight_scores(
            eye_contact_ratio=eye_ratio,
            filler_per_min=filler_pm,
            gestures_per_min=gestures_per_min,
            tonal_variation=tonal_std,
            expression_changes_per_min=expr_pm,
        )
        score_breakdown = _metric_score_breakdown(cards, expr_pm=expr_pm)
        priorities = [
            {
                "metric": str(x.get("metric", "")),
                "title": f"Fix {_fmt_metric_name(str(x.get('metric', '')))} first",
                "impact": "High" if i == 0 else "Medium",
                "why_now": str(x.get("reason", "")),
            }
            for i, x in enumerate([s for s in score_breakdown if int(s.get("delta", 0)) < 0][:3])
        ]
        metric_stories = [
            _story_for_metric(metric=m, cards=cards, events=events, expr_pm=expr_pm)
            for m in ["eye_contact", "filler_words", "speech_rate", "tonal_variation", "expression_change", "gestures"]
        ]
        coach_summary = _coach_summary_payload(
            score_breakdown=score_breakdown,
            confidence_score=confidence_score,
            energy_score=energy_score,
        )

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
            "timeline": {"bin_size_sec": 10, "bins": timeline},
            "events": events,
            "alerts": alerts,
            "engagement_drops": engagement_drop_events,
            "confidence_score": confidence_score,
            "energy_score": energy_score,
            "coach_summary": coach_summary,
            "score_breakdown": score_breakdown,
            "priorities": priorities,
            "metric_stories": metric_stories,
            "best_moments": best_moments,
            "worst_moments": refined_worst or worst_moments,
            "pauses": pauses,
            "clips": clips,
            "coach_comments": coach_comments,
            "quality": vision_out.quality,
            "speakers": getattr(vision_out, "speakers", []) or [],
            "transcript": {"text": speech_out.transcript[:20000]},
            "debug": {
                "agent_trace": agent_trace,
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

