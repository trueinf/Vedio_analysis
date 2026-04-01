from __future__ import annotations

import mimetypes
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from app.settings import settings


def _configured() -> bool:
    key = (settings.supabase_service_role_key or settings.supabase_service_key or "").strip()
    return bool(settings.supabase_url.strip() and key)


def _client():
    # Lazy import so local dev still works without Supabase configured.
    from supabase import create_client  # type: ignore

    key = (settings.supabase_service_role_key or settings.supabase_service_key or "").strip()
    return create_client(settings.supabase_url, key)


_WARNED_NOT_CONFIGURED = False


def _warn_not_configured() -> None:
    global _WARNED_NOT_CONFIGURED
    if _WARNED_NOT_CONFIGURED:
        return
    _WARNED_NOT_CONFIGURED = True
    print("[Supabase] Not configured (SUPABASE_URL + service key missing). Skipping Supabase persistence.")


def _bucket_file_size_limit() -> int:
    n = int(getattr(settings, "supabase_bucket_file_size_limit_bytes", 0) or 0)
    return max(0, n)


def _ensure_bucket_file_size_limit(sb: Any, bucket_id: str) -> None:
    """Raise per-bucket max object size (best-effort). storage3 expects file_size_limit as int bytes."""
    limit = _bucket_file_size_limit()
    if not limit:
        return
    try:
        sb.storage.update_bucket(bucket_id, {"file_size_limit": limit})  # type: ignore[attr-defined]
    except Exception:
        pass


def ensure_bucket_exists(bucket_name: str) -> None:
    """
    Creates the bucket if missing (idempotent best-effort) and sets file_size_limit when configured.
    Requires service role key.
    """
    if not _configured():
        _warn_not_configured()
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
        # Try a cheap list first (avoids raising on create).
        buckets = sb.storage.list_buckets()  # type: ignore[attr-defined]
        if isinstance(buckets, list) and any((b.get("name") == name) for b in buckets if isinstance(b, dict)):
            _ensure_bucket_file_size_limit(sb, name)
            return
    except Exception:
        # Fall through to create attempt.
        pass
    try:
        sb.storage.create_bucket(name, options=create_opts)  # type: ignore[attr-defined]
    except Exception:
        # Ignore "already exists" or transient errors; uploads will surface real problems.
        pass
    _ensure_bucket_file_size_limit(sb, name)


def create_signed_upload_url(*, bucket: str, path: str) -> dict[str, str]:
    """
    Create a signed upload URL for a given object path.
    Returns dict with at least: signed_url, token, path.
    """
    if not _configured():
        raise RuntimeError("Supabase is not configured")
    sb = _client()
    b = (bucket or settings.supabase_bucket).strip()
    p = (path or "").lstrip("/")
    if not b or not p:
        raise RuntimeError("bucket and path are required")
    ensure_bucket_exists(b)
    # storage3 bucket client
    bucket_client = sb.storage.from_(b)
    data = bucket_client.create_signed_upload_url(p)
    # storage3 returns object with attributes or dict-like
    if isinstance(data, dict):
        return {
            "signed_url": str(data.get("signed_url") or data.get("signedURL") or ""),
            "token": str(data.get("token") or ""),
            "path": p,
        }
    signed_url = str(getattr(data, "signed_url", "") or getattr(data, "signedURL", "") or "")
    token = str(getattr(data, "token", "") or "")
    return {"signed_url": signed_url, "token": token, "path": p}


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
) -> None:
    if not _configured():
        _warn_not_configured()
        return
    sb = _client()
    now = datetime.utcnow().isoformat()
    sb.table("analyses").upsert(
        {
            # New schema uses job_id as the stable identifier.
            "job_id": analysis_id,
            "updated_at": now,
            "source_type": source_type,
            "source_url": source_url or "",
            "title": title or "",
            "video_storage_path": video_storage_path or "",
            "duration_sec": int(duration_sec or 0),
            "status": status,
            "stage": stage or "",
            "progress": float(progress or 0.0),
            "error_message": error_message or "",
        }
    ).execute()


def update_analysis_status(*, analysis_id: str, status: str, stage: str, progress: float, error_message: str = "") -> None:
    if not _configured():
        _warn_not_configured()
        return
    sb = _client()
    # Use upsert keyed by job_id for compatibility with new schema.
    sb.table("analyses").upsert(
        {
            "job_id": analysis_id,
            "updated_at": datetime.utcnow().isoformat(),
            "status": status,
            "stage": stage,
            "progress": float(progress or 0.0),
            "error_message": error_message or "",
        }
    ).execute()


def put_result_json(*, analysis_id: str, result: dict[str, Any], result_version: str = "v1") -> None:
    if not _configured():
        _warn_not_configured()
        return
    sb = _client()
    # New schema stores the full payload on analyses.result_json.
    sb.table("analyses").upsert({"job_id": analysis_id, "result_json": result}).execute()


def list_analyses(limit: int = 200) -> list[dict[str, Any]]:
    if not _configured():
        _warn_not_configured()
        return []
    sb = _client()
    res = (
        sb.table("analyses")
        .select("*")
        .order("created_at", desc=True)
        .limit(int(limit or 200))
        .execute()
    )
    return list(res.data or [])


def get_analysis(analysis_id: str) -> dict[str, Any] | None:
    if not _configured():
        _warn_not_configured()
        return None
    sb = _client()
    res = sb.table("analyses").select("*").eq("job_id", analysis_id).limit(1).execute()
    rows = list(res.data or [])
    return rows[0] if rows else None


def get_result(analysis_id: str) -> dict[str, Any] | None:
    if not _configured():
        _warn_not_configured()
        return None
    sb = _client()
    res = sb.table("analyses").select("result_json").eq("job_id", analysis_id).limit(1).execute()
    rows = list(res.data or [])
    if not rows:
        return None
    return rows[0].get("result_json")  # type: ignore[return-value]


def upload_file_to_storage(*, local_path: str, storage_path: str, content_type: str | None = None) -> str:
    """
    Uploads a local file into Supabase Storage bucket.
    Returns the storage_path that was used.
    """
    if not _configured():
        _warn_not_configured()
        return storage_path
    sb = _client()
    bucket = sb.storage.from_(settings.supabase_bucket)
    p = Path(local_path)
    ct = content_type or (mimetypes.guess_type(str(p))[0] or "application/octet-stream")
    data = p.read_bytes()
    # Upsert=true so retries don't fail if file already exists.
    bucket.upload(storage_path, data, {"content-type": ct, "upsert": "true"})
    return storage_path


def download_file_from_storage(*, storage_path: str) -> bytes:
    """
    Downloads an object from Supabase Storage bucket and returns bytes.
    """
    if not _configured():
        raise RuntimeError("Supabase is not configured")
    sb = _client()
    bucket = sb.storage.from_(settings.supabase_bucket)
    data = bucket.download(storage_path)
    # storage3 may return bytes or a BytesIO-like object depending on version
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    if hasattr(data, "read"):
        return data.read()  # type: ignore[no-any-return]
    return bytes(data)  # fallback


def create_comparison_report(*, left_analysis_id: str, right_analysis_id: str, report: dict[str, Any]) -> str:
    if not _configured():
        return str(uuid.uuid4())
    sb = _client()
    rid = str(uuid.uuid4())
    sb.table("comparison_reports").insert(
        {
            "id": rid,
            "left_analysis_id": left_analysis_id,
            "right_analysis_id": right_analysis_id,
            "report_version": "v1",
            "report_json": report,
        }
    ).execute()
    return rid

