"""
Build channel performance payloads and call OpenAI for AI-written summaries.
"""
from __future__ import annotations

import json
import statistics
from typing import Any

from app.settings import settings
from app.supabase_repo import list_analyses_by_channel


def display_name_from_rows(completed: list[dict[str, Any]], fallback: str) -> str:
    for r in completed:
        ch = str(r.get("channel_name") or "").strip()
        if ch:
            return ch
    return fallback


def _mean(nums: list[float]) -> float | None:
    if not nums:
        return None
    return float(statistics.mean(nums))


def build_channel_summary_payload(channel_name: str) -> dict[str, Any]:
    """
    Structured stats from completed analyses for a channel (case-insensitive match).
    """
    cn = (channel_name or "").strip()
    rows = list_analyses_by_channel(cn, include_result_json=True)
    completed = [r for r in rows if (r.get("status") or "") == "completed"]
    completed.sort(key=lambda r: str(r.get("created_at") or ""))

    def conf_val(r: dict[str, Any]) -> float | None:
        v = r.get("confidence_score")
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    confs_all = [c for r in completed if (c := conf_val(r)) is not None]

    total_videos = len(completed)
    avg_confidence = round(float(statistics.mean(confs_all)), 1) if confs_all else 0.0

    engs = [float(r["energy_score"]) for r in completed if r.get("energy_score") is not None]
    avg_energy = round(float(statistics.mean(engs)), 1) if engs else 0.0

    wpms = [float(r["wpm"]) for r in completed if r.get("wpm") is not None]
    avg_wpm = round(float(statistics.mean(wpms)), 1) if wpms else 0.0

    eyes = [float(r["eye_contact_ratio"]) for r in completed if r.get("eye_contact_ratio") is not None]
    avg_eye = round(float(statistics.mean(eyes)), 3) if eyes else 0.0

    # Confidence trend: older half vs newer half (sorted ascending by time)
    confidence_trend: str = "stable"
    with_conf_series = [(r, c) for r in completed if (c := conf_val(r)) is not None]
    n = len(with_conf_series)
    if n >= 2:
        mid = n // 2
        first_half = [c for _, c in with_conf_series[:mid]]
        second_half = [c for _, c in with_conf_series[mid:]]
        fa = _mean(first_half)
        sa = _mean(second_half)
        if fa is not None and sa is not None:
            if sa - fa > 5:
                confidence_trend = "improving"
            elif fa - sa > 5:
                confidence_trend = "declining"
            else:
                confidence_trend = "stable"

    # Coach comments: exact text frequency
    comment_counts: dict[str, int] = {}
    for r in completed:
        rj = r.get("result_json")
        if not isinstance(rj, dict):
            continue
        cc = rj.get("coach_comments")
        if not isinstance(cc, list):
            continue
        for item in cc:
            if not isinstance(item, dict):
                continue
            t = str(item.get("comment") or "").strip()
            if t:
                comment_counts[t] = comment_counts.get(t, 0) + 1
    top_coach_patterns = sorted(comment_counts.items(), key=lambda x: -x[1])[:5]
    top_coach_patterns = [{"text": t, "count": c} for t, c in top_coach_patterns]

    best_video: dict[str, Any] | None = None
    worst_video: dict[str, Any] | None = None
    scored: list[tuple[str, float]] = []
    for r in completed:
        c = conf_val(r)
        if c is None:
            continue
        fn = str(r.get("original_filename") or r.get("title") or r.get("job_id") or "video")
        scored.append((fn, c))
    if scored:
        best = max(scored, key=lambda x: x[1])
        worst = min(scored, key=lambda x: x[1])
        best_video = {"filename": best[0], "confidence_score": round(best[1], 1)}
        worst_video = {"filename": worst[0], "confidence_score": round(worst[1], 1)}

    return {
        "channel_name": display_name_from_rows(completed, cn),
        "total_videos": total_videos,
        "avg_confidence": avg_confidence,
        "avg_energy": avg_energy,
        "avg_wpm": avg_wpm,
        "avg_eye_contact": avg_eye,
        "confidence_trend": confidence_trend,
        "top_coach_patterns": top_coach_patterns,
        "best_video": best_video,
        "worst_video": worst_video,
    }


def generate_channel_summary_text(payload: dict[str, Any]) -> str:
    """Call OpenAI Chat Completions; raises if API key missing or API error."""
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    from openai import OpenAI

    system = (
        "You are a professional media coach analyst. Write a concise 3-4 sentence performance summary "
        "for a content creator based on their video analysis data. Be specific, use the actual numbers, "
        "be constructive. Do not use bullet points. Write in third person referring to the channel name."
    )
    user_content = (
        "Analyze the following structured channel data (JSON) and write the summary as instructed.\n\n"
        + json.dumps(payload, indent=2)
    )

    model = (settings.openai_channel_summary_model or "gpt-4o-mini").strip() or "gpt-4o-mini"
    base = (settings.openai_base_url or "").strip()
    client = OpenAI(api_key=key, base_url=base) if base else OpenAI(api_key=key)
    msg = client.chat.completions.create(
        model=model,
        max_tokens=1024,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
    )
    text = (msg.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("Empty response from model")
    return text
