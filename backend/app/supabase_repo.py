from __future__ import annotations

import mimetypes
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from app.settings import settings


def _configured() -> bool:
    return bool(settings.supabase_url and settings.supabase_service_role_key)


def _client():
    from supabase import create_client  # type: ignore
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


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
    try:
        # on_conflict="id" means: if a row with this id already exists, UPDATE it instead of failing
        sb.table("analyses").upsert(payload, on_conflict="id").execute()
        print(f"[Supabase] upsert_analysis_row OK: {analysis_id} -> {status}")
    except Exception as e:
        print(f"[Supabase] upsert_analysis_row FAILED for {analysis_id}: {e}")


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


def put_result_json(*, analysis_id: str, result: dict[str, Any], result_version: str = "v1") -> None:
    if not _configured():
        return
    sb = _client()
    try:
        # Store result inline in the analyses row + persist commonly-used summary fields at top level.
        summary = (result.get("summary") or {}) if isinstance(result, dict) else {}
        cards = (result.get("cards") or {}) if isinstance(result, dict) else {}
        speech = (cards.get("speech_rate") or {}) if isinstance(cards, dict) else {}
        eye = (cards.get("eye_contact") or {}) if isinstance(cards, dict) else {}

        payload: dict[str, Any] = {
            "result_json": result,
            "overall_score": int((summary.get("overall_score") or 0) or 0),
            "wpm": float((speech.get("wpm") or 0.0) or 0.0),
            "eye_contact_ratio": float((eye.get("on_camera_ratio") or 0.0) or 0.0),
            "confidence_score": int((result.get("confidence_score") or 0) or 0),
            "energy_score": int((result.get("energy_score") or 0) or 0),
        }
        if str(result.get("original_filename") or "").strip():
            payload["original_filename"] = str(result.get("original_filename") or "").strip()

        sb.table("analyses").update(payload).eq("id", analysis_id).execute()
        print(f"[Supabase] put_result_json OK for {analysis_id}")
    except Exception as e:
        print(f"[Supabase] put_result_json FAILED for {analysis_id}: {e}")
    # Also try analysis_results table (old schema fallback)
    try:
        sb.table("analysis_results").upsert(
            {"analysis_id": analysis_id, "result_version": result_version, "result_json": result},
            on_conflict="analysis_id",
        ).execute()
    except Exception:
        pass


def list_analyses(limit: int = 200) -> list[dict[str, Any]]:
    if not _configured():
        return []
    sb = _client()
    try:
        res = (
            sb.table("analyses")
            .select("*")
            .order("created_at", desc=True)
            .limit(int(limit or 200))
            .execute()
        )
        return list(res.data or [])
    except Exception as e:
        print(f"[Supabase] list_analyses FAILED: {e}")
        return []


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

