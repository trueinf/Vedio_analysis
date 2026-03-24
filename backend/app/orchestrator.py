from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
import subprocess
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.agents.feedback_agent import FeedbackAgent
from app.agents.fusion_agent import BehaviorFusionAgent
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
        eye = float(b.get("eye_contact") or 0.0)
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

        eye_score = _clamp01(eye)
        tone_score = _clamp01(tonal_std / 60.0)
        gesture_score = _clamp01(gestures_pm / 4.0)
        filler_penalty = _clamp01(fillers_pm / 5.0)

        engagement = (eye_score * 0.3) + (tone_score * 0.3) + (gesture_score * 0.2) - (filler_penalty * 0.2)
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
            worst_moments.append({"t0": round(t0, 3), "t1": round(t1, 3), "reason": reason})

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
            "best_moments": best_moments,
            "worst_moments": refined_worst or worst_moments,
            "pauses": pauses,
            "clips": clips,
            "coach_comments": coach_comments,
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

