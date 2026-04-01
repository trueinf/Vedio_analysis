from __future__ import annotations

import traceback
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Job, JobStatus
from app.settings import settings
from app.utils.files import ensure_dir
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


def download_then_enqueue(job_id: str, url: str) -> None:
    db: Session = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        # Download step
        job.status = JobStatus.processing
        job.stage = "downloading"
        job.progress = 0.02
        job.updated_at = datetime.utcnow()
        db.commit()
        try:
            upsert_analysis_row(
                analysis_id=job.id,
                source_type="youtube_url",
                source_url=url,
                title="YouTube URL",
                video_storage_path="",
                duration_sec=int(job.duration_sec or 0),
                status=job.status.value,
                stage=job.stage,
                progress=float(job.progress or 0.0),
            )
        except Exception:
            pass

        out_path = job.video_path
        _download_youtube_video(url, out_path)

        # Probe duration
        dur = probe_duration_sec(out_path, ffprobe_bin=settings.ffprobe_bin)
        job.duration_sec = int(dur or 0)
        # Upload the downloaded MP4 to Supabase Storage (best-effort).
        storage_path = f"{job.id}/youtube.mp4"
        try:
            upload_file_to_storage(local_path=str(out_path), storage_path=storage_path, content_type="video/mp4")
            upsert_analysis_row(
                analysis_id=job.id,
                source_type="youtube_url",
                source_url=url,
                title="YouTube URL",
                video_storage_path=storage_path,
                duration_sec=int(job.duration_sec or 0),
                status=job.status.value,
                stage="queued",
                progress=0.05,
            )
        except Exception:
            pass
        job.stage = "queued"
        job.progress = 0.05
        job.updated_at = datetime.utcnow()
        db.commit()

        # Hand off to normal processing pipeline
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
                    title="YouTube URL",
                    video_storage_path="",
                    duration_sec=int(job.duration_sec or 0),
                    status=job.status.value,
                    stage=job.stage,
                    progress=float(job.progress or 0.0),
                    error_message=job.error_message,
                )
            except Exception:
                pass
    finally:
        db.close()

