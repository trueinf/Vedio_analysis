from __future__ import annotations

import os
from typing import Any

_client = None


def get_supabase_client():
    """
    Returns a supabase-py client using a server-side key.

    Env compatibility:
    - SUPABASE_SERVICE_KEY (requested by new architecture)
    - SUPABASE_SERVICE_ROLE_KEY (existing project env)
    """
    global _client
    if _client is not None:
        return _client
    try:
        from supabase import ClientOptions, create_client  # type: ignore

        url = os.getenv("SUPABASE_URL", "").strip()
        key = (os.getenv("SUPABASE_SERVICE_KEY", "") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip()
        if not url or not key:
            return None
        # Prevent long hangs when Supabase is unreachable by using explicit timeouts.
        opts = ClientOptions(
            postgrest_client_timeout=10,
            storage_client_timeout=10,
            function_client_timeout=10,
        )
        _client = create_client(url, key, options=opts)
        return _client
    except Exception as e:
        print(f"[Supabase] Client init failed: {e}")
        return None


def upsert_analysis(job_id: str, data: dict[str, Any]) -> bool:
    client = get_supabase_client()
    if not client:
        return False
    try:
        client.table("analyses").upsert({"job_id": job_id, **data}).execute()
        return True
    except Exception as e:
        print(f"[Supabase] upsert_analysis failed: {e}")
        return False


def update_analysis_status(job_id: str, status: str, stage: str = "", progress: float = 0.0, error: str = "") -> bool:
    client = get_supabase_client()
    if not client:
        return False
    try:
        payload: dict[str, Any] = {"job_id": job_id, "status": status}
        if stage:
            payload["stage"] = stage
        # Important: progress can be 0.0, still meaningful
        payload["progress"] = float(progress or 0.0)
        if error:
            payload["error_message"] = error
        client.table("analyses").upsert(payload).execute()
        return True
    except Exception as e:
        print(f"[Supabase] update_analysis_status failed: {e}")
        return False


def store_completed_analysis(
    job_id: str,
    result: dict[str, Any],
    original_filename: str,
    duration_sec: int,
    channel_name: str = "",
) -> bool:
    client = get_supabase_client()
    if not client:
        return False
    try:
        summary = result.get("summary", {}) or {}
        cards = result.get("cards", {}) or {}
        sr = cards.get("speech_rate", {}) or {}
        ec = cards.get("eye_contact", {}) or {}
        fw = cards.get("filler_words", {}) or {}
        gs = cards.get("gestures", {}) or {}
        tv = cards.get("tonal_variation", {}) or {}

        payload: dict[str, Any] = {
            "job_id": job_id,
            "original_filename": original_filename or "",
            "duration_sec": int(duration_sec or 0),
            "channel_name": channel_name or "",
            "status": "completed",
            "stage": "completed",
            "progress": 1.0,
            "result_json": result,
            "overall_score": int(summary.get("overall_score") or 0),
            "wpm": float(sr.get("wpm") or 0.0),
            "eye_contact_ratio": float(ec.get("on_camera_ratio") or 0.0),
            "fillers_per_min": float(fw.get("per_minute") or 0.0),
            "gestures_per_min": float(gs.get("per_minute") or 0.0),
            "tonal_label": str(tv.get("label") or ""),
            "confidence_score": int(result.get("confidence_score") or 0),
            "energy_score": int(result.get("energy_score") or 0),
        }
        client.table("analyses").upsert(payload).execute()
        return True
    except Exception as e:
        print(f"[Supabase] store_completed_analysis failed: {e}")
        return False


def get_analysis_by_job_id(job_id: str) -> dict[str, Any] | None:
    client = get_supabase_client()
    if not client:
        return None
    try:
        res = client.table("analyses").select("*").eq("job_id", job_id).single().execute()
        return res.data  # type: ignore[return-value]
    except Exception:
        return None


def list_analyses(limit: int = 50, offset: int = 0, status: str = "") -> list[dict[str, Any]]:
    client = get_supabase_client()
    if not client:
        return []
    try:
        q = (
            client.table("analyses")
            .select(
                "id, job_id, created_at, updated_at, original_filename, duration_sec, status, stage, progress, channel_name, overall_score, wpm, eye_contact_ratio, fillers_per_min, gestures_per_min, tonal_label, confidence_score, energy_score, error_message"
            )
            .order("created_at", desc=True)
            .limit(int(limit or 50))
            .offset(int(offset or 0))
        )
        if status:
            q = q.eq("status", status)
        res = q.execute()
        return list(res.data or [])
    except Exception as e:
        print(f"[Supabase] list_analyses failed: {e}")
        return []


def store_comparison(
    source_job_id: str,
    target_job_id: str | None,
    report: dict[str, Any],
    niche: str,
    goal: str,
    platform: str,
    compare_mode: str,
    competitor_channel: str,
) -> dict[str, Any] | None:
    client = get_supabase_client()
    if not client:
        return None
    try:
        source = client.table("analyses").select("id").eq("job_id", source_job_id).single().execute()
        source_id = source.data["id"] if source.data else None
        target_id = None
        if target_job_id:
            target = client.table("analyses").select("id").eq("job_id", target_job_id).single().execute()
            target_id = target.data["id"] if target.data else None

        sim = report.get("score_simulation", {}) or {}
        payload: dict[str, Any] = {
            "source_analysis_id": source_id,
            "target_analysis_id": target_id,
            "niche": niche,
            "goal": goal,
            "platform": platform,
            "compare_mode": compare_mode,
            "competitor_channel": competitor_channel,
            "report_json": report,
            "source_score": int(sim.get("current_score") or 0),
            "projected_score": int(sim.get("projected_score") or 0),
        }
        res = client.table("comparisons").insert(payload).execute()
        rows = list(res.data or [])
        return rows[0] if rows else None
    except Exception as e:
        print(f"[Supabase] store_comparison failed: {e}")
        return None

