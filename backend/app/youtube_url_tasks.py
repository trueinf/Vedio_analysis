from __future__ import annotations

import traceback
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Job, JobStatus
from app.settings import settings
from app.utils.files import ensure_dir, safe_filename
from app.video_meta import probe_duration_sec
from app.worker_queue import enqueue_job
from app.supabase_repo import upload_file_to_storage, upsert_analysis_row


def _download_youtube_video(url: str, out_path: str) -> None:
    from yt_dlp import YoutubeDL

    ensure_dir(str(Path(out_path).parent))
    class _YDLLogger:
        def debug(self, msg: str) -> None:
            return

        def warning(self, msg: str) -> None:
            return

        def error(self, msg: str) -> None:
            return

    ydl_opts = {
        "outtmpl": out_path,
        "quiet": True,
        "no_warnings": True,
        # Avoid Windows non-TTY progress rendering issues (minicurses -> OSError: [Errno 22]).
        "noprogress": True,
        "progress_with_newline": True,
        "no_color": True,
        "logger": _YDLLogger(),
        "noplaylist": True,
        "retries": 3,
        # Force a single progressive MP4 (has both audio+video) to avoid ffmpeg merge requirement.
        # Some videos only offer split DASH streams; in that case, we'll fall back to best (may still require ffmpeg).
        "format": "best[ext=mp4][acodec!=none][vcodec!=none][height<=720]/best[ext=mp4][acodec!=none][vcodec!=none]/best",
        "ffmpeg_location": settings.ffmpeg_bin,
    }
    with YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])


def _extract_youtube_meta(url: str) -> tuple[str, str]:
    """Return (title, thumbnail_url) without downloading the video."""
    from yt_dlp import YoutubeDL

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
    }
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not isinstance(info, dict):
        return "YouTube", ""
    title = str(info.get("title") or "YouTube").strip() or "YouTube"
    thumb = str(info.get("thumbnail") or "").strip()
    if not thumb:
        thumbs = info.get("thumbnails")
        if isinstance(thumbs, list) and thumbs:
            last = thumbs[-1]
            if isinstance(last, dict):
                thumb = str(last.get("url") or "").strip()
    return title, thumb


def download_then_enqueue(job_id: str, url: str, channel_name: str = "") -> None:
    title_disp = "YouTube"
    thumb_url = ""
    db: Session = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        try:
            title_disp, thumb_url = _extract_youtube_meta(url)
        except Exception:
            pass
        title_disp = (title_disp or "YouTube")[:220]
        ofn = safe_filename(f"{title_disp}.mp4")

        job.status = JobStatus.processing
        job.stage = "downloading"
        job.progress = 0.02
        job.original_filename = ofn
        job.updated_at = datetime.utcnow()
        db.commit()
        try:
            upsert_analysis_row(
                analysis_id=job.id,
                source_type="youtube_url",
                source_url=url,
                title=title_disp,
                video_storage_path="",
                duration_sec=int(job.duration_sec or 0),
                status=job.status.value,
                stage=job.stage,
                progress=float(job.progress or 0.0),
                channel_name=channel_name,
                thumbnail_url=thumb_url,
            )
        except Exception:
            pass

        out_path = job.video_path
        _download_youtube_video(url, out_path)

        dur = probe_duration_sec(out_path, ffprobe_bin=settings.ffprobe_bin)
        job.duration_sec = int(dur or 0)
        storage_path = f"{job.id}/youtube.mp4"
        try:
            upload_file_to_storage(local_path=str(out_path), storage_path=storage_path, content_type="video/mp4")
            upsert_analysis_row(
                analysis_id=job.id,
                source_type="youtube_url",
                source_url=url,
                title=title_disp,
                video_storage_path=storage_path,
                duration_sec=int(job.duration_sec or 0),
                status=job.status.value,
                stage="queued",
                progress=0.05,
                channel_name=channel_name,
                thumbnail_url=thumb_url,
            )
        except Exception:
            pass
        job.stage = "queued"
        job.progress = 0.05
        job.updated_at = datetime.utcnow()
        db.commit()

        enqueue_job(job_id)
    except Exception as e:
        job = db.get(Job, job_id)
        if job:
            job.status = JobStatus.failed
            job.stage = "failed"
            job.error_message = f"{e}\n{traceback.format_exc()}"
            job.updated_at = datetime.utcnow()
            db.commit()
            try:
                upsert_analysis_row(
                    analysis_id=job.id,
                    source_type="youtube_url",
                    source_url=url,
                    title=title_disp,
                    video_storage_path="",
                    duration_sec=int(job.duration_sec or 0),
                    status=job.status.value,
                    stage=job.stage,
                    progress=float(job.progress or 0.0),
                    error_message=job.error_message,
                    channel_name=channel_name,
                )
            except Exception:
                pass
    finally:
        db.close()

