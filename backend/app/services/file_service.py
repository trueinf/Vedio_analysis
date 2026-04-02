from __future__ import annotations

import os
from pathlib import Path

from app.settings import settings
from app.utils.files import ensure_dir, safe_filename

ALLOWED_VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"})


def ensure_upload_dir() -> Path:
    return ensure_dir(settings.uploads_dir)


def extension_from_filename(filename: str) -> str:
    ext = os.path.splitext((filename or "").strip())[1].lower()
    if not ext:
        return ".mp4"
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        return ext  # still persist what user sent; pipeline may normalize
    return ext


def build_local_upload_path(job_id: str, original_filename: str) -> Path:
    """Unique path under uploads: {job_id}{ext} with safe extension."""
    original = safe_filename(original_filename or "upload.mp4")
    ext = extension_from_filename(original)
    ensure_upload_dir()
    return Path(settings.uploads_dir) / f"{job_id}{ext}"


def assert_local_file_exists(path: str | Path) -> str:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"Video file not found: {path}")
    return str(p.resolve())


def get_video_path_for_job(*, local_path: str, job_id: str) -> str:
    """
    Resolve a playable local path for the pipeline.
    Prefer existing local file; worker may download from Supabase separately via _ensure_local_upload_file.
    """
    return assert_local_file_exists(local_path)
