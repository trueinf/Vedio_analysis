from __future__ import annotations

import logging
import mimetypes
import time
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path
import statistics
from typing import Any

from app.settings import settings

logger = logging.getLogger(__name__)

_supabase_client: Any | None = None


def _configured() -> bool:
    return bool(settings.supabase_url and settings.supabase_service_role_key)


def reset_supabase() -> None:
    global _supabase_client
    _supabase_client = None


def get_supabase() -> Any:
    """
    Cached Supabase client. We reset+recreate on transient transport failures (Railway idle timeouts).
    """
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client
    from supabase import create_client  # type: ignore

    _supabase_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _supabase_client


def _client():
    return get_supabase()


def _is_retryable_transport_error(e: Exception) -> bool:
    s = str(e)
    needles = ("Broken pipe", "Connection reset", "ConnectionError", "BrokenPipeError", "ReadTimeout")
    return any(n in s for n in needles)


def supabase_retry(max_attempts: int = 3, delay: float = 0.5):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_error: Exception | None = None
            for attempt in range(int(max_attempts or 3)):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    if _is_retryable_transport_error(e) and attempt < int(max_attempts or 3) - 1:
                        try:
                            reset_supabase()
                        except Exception:
                            pass
                        time.sleep(float(delay) * (attempt + 1))
                        continue
                    raise
            if last_error is not None:
                raise last_error
            raise RuntimeError("Supabase retry failed without exception")

        return wrapper

    return decorator


def _bucket_file_size_limit() -> int:
    n = int(getattr(settings, "supabase_bucket_file_size_limit_bytes", 0) or 0)
    return max(0, n)


def _ensure_bucket_file_size_limit(sb: Any, bucket_id: str) -> None:
    limit = _bucket_file_size_limit()
    if not limit:
        return
    try:
        sb.storage.update_bucket(bucket_id, {"file_size_limit": limit})
    except Exception:
        pass


@supabase_retry()
def ensure_bucket_exists(bucket_name: str) -> None:
    if not _configured():
        return
    sb = _client()
    name = (bucket_name or "").strip()
    if not name:
        return
    limit = _bucket_file_size_limit()
    create_opts: dict[str, Any] = {"public": False}
    if limit:
        create_opts["file_size_limit"] = limit
    try:
        buckets = sb.storage.list_buckets()
        if isinstance(buckets, list) and any((b.get("name") == name) for b in buckets if isinstance(b, dict)):
            _ensure_bucket_file_size_limit(sb, name)
            return
    except Exception:
        pass
    try:
        sb.storage.create_bucket(name, options=create_opts)
    except Exception:
        pass
    _ensure_bucket_file_size_limit(sb, name)


@supabase_retry()
def create_signed_upload_url(*, bucket: str, path: str) -> dict[str, str]:
    if not _configured():
        raise RuntimeError("Supabase is not configured")
    sb = _client()
    b = (bucket or settings.supabase_bucket).strip()
    p = (path or "").lstrip("/")
    if not b or not p:
        raise RuntimeError("bucket and path are required")
    ensure_bucket_exists(b)
    bucket_client = sb.storage.from_(b)
    data = bucket_client.create_signed_upload_url(p)
    if isinstance(data, dict):
        return {
            "signed_url": str(data.get("signed_url") or data.get("signedURL") or ""),
            "token": str(data.get("token") or ""),
            "path": p,
        }
    signed_url = str(getattr(data, "signed_url", "") or getattr(data, "signedURL", "") or "")
    token = str(getattr(data, "token", "") or "")
    return {"signed_url": signed_url, "token": token, "path": p}


@supabase_retry()
def create_signed_download_url(*, bucket: str, path: str, expires_in_sec: int = 3600) -> dict[str, str]:
    """
    Create a signed *download* URL for a private object in Storage.
    Uses backend service role key (safe for Netlify clients).
    """
    if not _configured():
        raise RuntimeError("Supabase is not configured")
    sb = _client()
    b = (bucket or settings.supabase_bucket).strip()
    p = (path or "").lstrip("/")
    if not b or not p:
        raise RuntimeError("bucket and path are required")
    ensure_bucket_exists(b)
    bucket_client = sb.storage.from_(b)
    data = bucket_client.create_signed_url(p, int(expires_in_sec or 3600))
    if isinstance(data, dict):
        return {"signed_url": str(data.get("signed_url") or data.get("signedURL") or ""), "path": p}
    signed_url = str(getattr(data, "signed_url", "") or getattr(data, "signedURL", "") or "")
    return {"signed_url": signed_url, "path": p}

@supabase_retry()
def upsert_analysis_row(
    *,
    analysis_id: str,
    source_type: str,
    source_url: str,
    title: str,
    video_storage_path: str,
    duration_sec: int,
    status: str,
    stage: str,
    progress: float,
    error_message: str = "",
    channel_name: str = "",
    thumbnail_url: str = "",
) -> None:
    if not _configured():
        return
    sb = _client()
    now = datetime.utcnow().isoformat()
    payload = {
        "id": analysis_id,
        "job_id": analysis_id,
        "updated_at": now,
        "source_type": source_type,
        "source_url": source_url or "",
        # Keep dashboard UX friendly: show the uploaded filename even before completion.
        "original_filename": title or "",
        "title": title or "",
        "video_storage_path": video_storage_path or "",
        "duration_sec": int(duration_sec or 0),
        "status": status,
        "stage": stage or "",
        "progress": float(progress or 0.0),
        "error_message": error_message or "",
    }
    cn = (channel_name or "").strip()
    if cn:
        payload["channel_name"] = cn
    tu = (thumbnail_url or "").strip()
    if tu:
        payload["thumbnail_url"] = tu
    try:
        # Conflict on job_id (unique) — avoids duplicate key on analyses_job_id_key vs id-only upsert.
        sb.table("analyses").upsert(payload, on_conflict="job_id").execute()
        print(f"[Supabase] upsert_analysis_row OK: {analysis_id} -> {status}")
    except Exception as e:
        print(f"[Supabase] upsert_analysis_row FAILED for {analysis_id}: {e}")


@supabase_retry()
def update_analysis_status(
    *, analysis_id: str, status: str, stage: str, progress: float, error_message: str = ""
) -> None:
    if not _configured():
        return
    sb = _client()
    try:
        sb.table("analyses").update(
            {
                "updated_at": datetime.utcnow().isoformat(),
                "status": status,
                "stage": stage,
                "progress": float(progress or 0.0),
                "error_message": error_message or "",
            }
        ).eq("id", analysis_id).execute()
    except Exception as e:
        print(f"[Supabase] update_analysis_status FAILED for {analysis_id}: {e}")


@supabase_retry()
def set_analysis_video_storage_path(*, analysis_id: str, video_storage_path: str) -> None:
    """
    Point analyses.video_storage_path at a Storage object (e.g. H.264 playback.mp4 after worker normalize).
    """
    if not _configured():
        return
    sb = _client()
    try:
        sb.table("analyses").update(
            {
                "updated_at": datetime.utcnow().isoformat(),
                "video_storage_path": (video_storage_path or "").strip(),
            }
        ).eq("id", analysis_id).execute()
        print(f"[Supabase] set_analysis_video_storage_path OK: {analysis_id} -> {video_storage_path}")
    except Exception as e:
        print(f"[Supabase] set_analysis_video_storage_path FAILED for {analysis_id}: {e}")


@supabase_retry()
def rename_channel_name_in_analyses(*, old_name: str, new_name: str) -> int:
    """
    Best-effort migration: update Supabase analyses.channel_name from old -> new (case-insensitive).
    Returns the number of rows returned by the API client (may be 0 if not supported).
    """
    if not _configured():
        return 0
    old = (old_name or "").strip()
    new = (new_name or "").strip()
    if not old or not new or old.lower() == new.lower():
        return 0
    sb = _client()
    try:
        # .ilike() is used elsewhere in this repo and works for case-insensitive matching.
        res = sb.table("analyses").update({"channel_name": new}).ilike("channel_name", old).execute()
        data = getattr(res, "data", None)
        if isinstance(data, list):
            return len(data)
    except Exception as e:
        print(f"[Supabase] rename_channel_name_in_analyses FAILED: {e}")
    return 0


@supabase_retry()
def put_result_json(
    *,
    analysis_id: str,
    result: dict[str, Any],
    result_version: str = "v1",
    finalize_completed: bool = False,
    channel_name: str = "",
    duration_sec: int = 0,
) -> None:
    if not _configured():
        return
    sb = _client()
    try:
        # Store result inline in the analyses row + persist commonly-used summary fields at top level.
        res = result if isinstance(result, dict) else {}
        summary = res.get("summary") or {}
        if not isinstance(summary, dict):
            summary = {}
        cards = res.get("cards") or {}
        if not isinstance(cards, dict):
            cards = {}
        speech = cards.get("speech_rate") or {}
        if not isinstance(speech, dict):
            speech = {}
        eye = cards.get("eye_contact") or {}
        if not isinstance(eye, dict):
            eye = {}
        fw = cards.get("filler_words") or {}
        if not isinstance(fw, dict):
            fw = {}
        gs = cards.get("gestures") or {}
        if not isinstance(gs, dict):
            gs = {}
        tv = cards.get("tonal_variation") or {}
        if not isinstance(tv, dict):
            tv = {}

        payload: dict[str, Any] = {
            "updated_at": datetime.utcnow().isoformat(),
            "result_json": result,
            "overall_score": int((summary.get("overall_score") or 0) or 0),
            "wpm": float((speech.get("wpm") or 0.0) or 0.0),
            "eye_contact_ratio": float((eye.get("on_camera_ratio") or 0.0) or 0.0),
            "confidence_score": int((res.get("confidence_score") or 0) or 0),
            "energy_score": int((res.get("energy_score") or 0) or 0),
        }
        if str(res.get("original_filename") or "").strip():
            payload["original_filename"] = str(res.get("original_filename") or "").strip()

        if finalize_completed:
            payload["status"] = "completed"
            payload["stage"] = "completed"
            payload["progress"] = 1.0
            payload["progress_int"] = 100
            payload["fillers_per_min"] = float(fw.get("per_minute") or 0.0)
            payload["gestures_per_min"] = float(gs.get("per_minute") or 0.0)
            payload["tonal_label"] = str(tv.get("label") or "")
            payload["duration_sec"] = int(duration_sec or 0)
            if channel_name:
                payload["channel_name"] = channel_name

        try:
            sb.table("analyses").update(payload).eq("job_id", analysis_id).execute()
        except Exception:
            p2 = dict(payload)
            p2.pop("progress_int", None)
            try:
                sb.table("analyses").update(p2).eq("job_id", analysis_id).execute()
            except Exception:
                sb.table("analyses").update(payload).eq("id", analysis_id).execute()

        logger.info(
            "Saved result_json for job %s, length: %s",
            analysis_id,
            len(str(result)),
        )
        print(f"[Supabase] put_result_json OK for {analysis_id}")
    except Exception as e:
        logger.exception("put_result_json failed for %s", analysis_id)
        print(f"[Supabase] put_result_json FAILED for {analysis_id}: {e}")
    # Also try analysis_results table (old schema fallback)
    try:
        sb.table("analysis_results").upsert(
            {"analysis_id": analysis_id, "result_version": result_version, "result_json": result},
            on_conflict="analysis_id",
        ).execute()
    except Exception:
        pass


# Listing 500 rows with select("*") pulls huge result_json blobs — keep list views lean.
_LIST_ANALYSES_COLUMNS_NO_RESULT = (
    "id, job_id, created_at, updated_at, original_filename, video_url, video_storage_path, "
    "duration_sec, status, stage, progress, progress_int, error_message, channel_name, "
    "overall_score, wpm, eye_contact_ratio, fillers_per_min, gestures_per_min, tonal_label, "
    "confidence_score, energy_score, thumbnail_url, tags, source_type, source_url, title"
)


@supabase_retry()
def list_analyses(limit: int = 200, *, include_result_json: bool = False) -> list[dict[str, Any]]:
    if not _configured():
        return []
    sb = _client()
    lim = max(1, min(int(limit or 200), 500))
    sel = "*" if include_result_json else _LIST_ANALYSES_COLUMNS_NO_RESULT
    try:
        res = sb.table("analyses").select(sel).order("created_at", desc=True).limit(lim).execute()
        return list(res.data or [])
    except Exception as e:
        print(f"[Supabase] list_analyses FAILED: {e}")
        # Older DBs may miss a column — fall back to star (slower).
        if not include_result_json:
            try:
                res = (
                    sb.table("analyses")
                    .select("*")
                    .order("created_at", desc=True)
                    .limit(lim)
                    .execute()
                )
                return list(res.data or [])
            except Exception as e2:
                print(f"[Supabase] list_analyses fallback FAILED: {e2}")
        return []


def _escape_ilike_exact(value: str) -> str:
    """Escape % and _ so ILIKE treats them as literals (exact match, case-insensitive)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@supabase_retry()
def list_analyses_by_channel(channel_name: str, *, include_result_json: bool = True) -> list[dict[str, Any]]:
    """
    All analyses for a channel_name match (case-insensitive, trimmed), oldest first.
    Used for channel report trends and channel-vs-channel compare.
    """
    if not _configured():
        return []
    sb = _client()
    cn = (channel_name or "").strip()
    if not cn:
        return []
    sel = "*" if include_result_json else _LIST_ANALYSES_COLUMNS_NO_RESULT
    lim = 10_000
    pattern = _escape_ilike_exact(cn)
    try:
        res = (
            sb.table("analyses")
            .select(sel)
            .ilike("channel_name", pattern)
            .order("created_at", desc=False)
            .limit(lim)
            .execute()
        )
        rows = list(res.data or [])
        # If DB stores different casing only, ilike exact pattern still matches; if ilike failed silently, filter:
        if not rows:
            key = cn.lower()
            res2 = (
                sb.table("analyses")
                .select(sel)
                .order("created_at", desc=False)
                .limit(min(lim, 5000))
                .execute()
            )
            rows = [
                r
                for r in (res2.data or [])
                if (str(r.get("channel_name") or "").strip().lower() == key)
            ]
        return rows
    except Exception as e:
        print(f"[Supabase] list_analyses_by_channel FAILED: {e}")
        try:
            res = (
                sb.table("analyses")
                .select(sel)
                .order("created_at", desc=False)
                .limit(5000)
                .execute()
            )
            key = cn.lower()
            return [
                r
                for r in (res.data or [])
                if (str(r.get("channel_name") or "").strip().lower() == key)
            ]
        except Exception as e2:
            print(f"[Supabase] list_analyses_by_channel fallback FAILED: {e2}")
            return []


@supabase_retry()
def aggregate_analyses_by_channel_name() -> dict[str, dict[str, Any]]:
    """
    Group Supabase analyses by channel_name (case-insensitive key).
    Used for GET /api/channels/summary — no schema changes.
    """
    if not _configured():
        return {}
    sb = _client()
    try:
        res = (
            sb.table("analyses")
            .select(
                "channel_name, status, confidence_score, energy_score, eye_contact_ratio, created_at, thumbnail_url"
            )
            .limit(8000)
            .execute()
        )
        rows = list(res.data or [])
    except Exception as e:
        print(f"[Supabase] aggregate_analyses_by_channel_name FAILED: {e}")
        return {}

    buckets: dict[str, list[dict[str, Any]]] = {}
    display: dict[str, str] = {}
    for row in rows:
        cn = (row.get("channel_name") or "").strip()
        if not cn:
            continue
        key = cn.lower()
        if key not in buckets:
            buckets[key] = []
            display[key] = cn
        buckets[key].append(row)

    out: dict[str, dict[str, Any]] = {}
    for key, br in buckets.items():
        total = len(br)
        completed_count = sum(1 for r in br if (r.get("status") or "") == "completed")
        processing_count = sum(1 for r in br if (r.get("status") or "") == "processing")
        confs = [float(r["confidence_score"]) for r in br if r.get("confidence_score") is not None]
        engs = [float(r["energy_score"]) for r in br if r.get("energy_score") is not None]
        eyes = [float(r["eye_contact_ratio"]) for r in br if r.get("eye_contact_ratio") is not None]
        avg_c = round(float(statistics.mean(confs)), 1) if confs else 0.0
        avg_e = round(float(statistics.mean(engs)), 1) if engs else 0.0
        avg_eye = round(float(statistics.mean(eyes)), 3) if eyes else 0.0

        times: list[str] = []
        for r in br:
            ca = r.get("created_at")
            if ca:
                times.append(str(ca))
        last_at = max(times) if times else ""

        thumb: str | None = None
        completed_rows = [r for r in br if (r.get("status") or "") == "completed"]
        completed_rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        for r in completed_rows:
            t = (r.get("thumbnail_url") or "").strip()
            if t:
                thumb = t
                break

        # Latest 5 vs previous 5 completed videos (by created_at desc) with confidence scores — trend inputs
        conf_series = [
            r
            for r in completed_rows
            if r.get("confidence_score") is not None and str(r.get("confidence_score")).strip() != ""
        ]
        latest_5 = conf_series[:5]
        previous_5 = conf_series[5:10]
        recent_conf_vals = [float(r["confidence_score"]) for r in latest_5]
        prev_conf_vals = [float(r["confidence_score"]) for r in previous_5]
        recent_avg_confidence: float | None = None
        previous_avg_confidence: float | None = None
        if recent_conf_vals:
            recent_avg_confidence = round(float(statistics.mean(recent_conf_vals)), 1)
        if len(prev_conf_vals) >= 5:
            previous_avg_confidence = round(float(statistics.mean(prev_conf_vals)), 1)

        out[key] = {
            "display_name": display.get(key, key),
            "totalVideos": total,
            "completedCount": completed_count,
            "processingCount": processing_count,
            "avgConfidence": avg_c,
            "avgEnergy": avg_e,
            "avgEyeContact": avg_eye,
            "lastAnalyzedAt": last_at,
            "thumbnailUrl": thumb,
            "recentAvgConfidence": recent_avg_confidence,
            "previousAvgConfidence": previous_avg_confidence,
        }
    return out


@supabase_retry()
def get_analysis(analysis_id: str) -> dict[str, Any] | None:
    if not _configured():
        return None
    sb = _client()
    try:
        res = sb.table("analyses").select("*").eq("job_id", analysis_id).limit(1).execute()
        rows = list(res.data or [])
        if rows:
            return rows[0]
        res = sb.table("analyses").select("*").eq("id", analysis_id).limit(1).execute()
        rows = list(res.data or [])
        return rows[0] if rows else None
    except Exception as e:
        print(f"[Supabase] get_analysis FAILED: {e}")
        return None


@supabase_retry()
def get_result(analysis_id: str) -> dict[str, Any] | None:
    if not _configured():
        return None
    sb = _client()
    # Prefer normalized analysis_results + job_id lookups when available
    try:
        from app.supabase_client import get_result_json_for_job

        rj = get_result_json_for_job(analysis_id)
        if rj:
            return rj
    except Exception:
        pass
    # Try result_json column in analyses first
    try:
        res = sb.table("analyses").select("result_json").eq("job_id", analysis_id).limit(1).execute()
        rows = list(res.data or [])
        if rows and rows[0].get("result_json"):
            return rows[0]["result_json"]
    except Exception:
        pass
    try:
        res = sb.table("analyses").select("result_json").eq("id", analysis_id).limit(1).execute()
        rows = list(res.data or [])
        if rows and rows[0].get("result_json"):
            return rows[0]["result_json"]
    except Exception:
        pass
    # Fallback: analysis_results table keyed by job_id (legacy)
    try:
        res = sb.table("analysis_results").select("result_json").eq("analysis_id", analysis_id).limit(1).execute()
        rows = list(res.data or [])
        if rows:
            return rows[0].get("result_json")
    except Exception as e:
        print(f"[Supabase] get_result FAILED for {analysis_id}: {e}")
    return None


@supabase_retry()
def upload_file_to_storage(*, local_path: str, storage_path: str, content_type: str | None = None) -> str:
    if not _configured():
        return storage_path
    sb = _client()
    ensure_bucket_exists(settings.supabase_bucket)
    bucket = sb.storage.from_(settings.supabase_bucket)
    p = Path(local_path)
    if not p.exists():
        print(f"[Supabase] upload_file_to_storage: file not found: {local_path}")
        return storage_path
    ct = content_type or (mimetypes.guess_type(str(p))[0] or "application/octet-stream")
    data = p.read_bytes()
    try:
        bucket.upload(storage_path, data, {"content-type": ct, "upsert": "true"})
        print(f"[Supabase] upload_file_to_storage OK: {storage_path} ({len(data)} bytes)")
    except Exception as e:
        print(f"[Supabase] upload_file_to_storage FAILED for {storage_path}: {e}")
        raise
    return storage_path


@supabase_retry()
def download_file_from_storage(*, storage_path: str) -> bytes:
    if not _configured():
        raise RuntimeError("Supabase is not configured")
    sb = _client()
    bucket = sb.storage.from_(settings.supabase_bucket)
    data = bucket.download(storage_path)
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    if hasattr(data, "read"):
        return data.read()
    return bytes(data)


@supabase_retry()
def create_comparison_report(*, left_analysis_id: str, right_analysis_id: str, report: dict[str, Any]) -> str:
    if not _configured():
        return str(uuid.uuid4())
    sb = _client()
    rid = str(uuid.uuid4())
    try:
        sb.table("comparison_reports").insert(
            {
                "id": rid,
                "left_analysis_id": left_analysis_id,
                "right_analysis_id": right_analysis_id,
                "report_version": "v1",
                "report_json": report,
            }
        ).execute()
    except Exception as e:
        print(f"[Supabase] create_comparison_report FAILED: {e}")
    return rid

