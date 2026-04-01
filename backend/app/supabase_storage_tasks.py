from __future__ import annotations

import traceback
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Job, JobStatus
from app.settings import settings
from app.supabase_repo import download_file_from_storage, upsert_analysis_row
from app.utils.files import ensure_dir
from app.video_meta import probe_duration_sec
from app.worker_queue import enqueue_job


def download_from_supabase_then_enqueue(job_id: str, storage_path: str) -> None:
    """
    Downloads a video from Supabase Storage into the job's local video_path,
    probes duration, updates job, then enqueues normal analysis.
    """
    db: Session = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.processing
        job.stage = "downloading"
        job.progress = 0.02
        job.updated_at = datetime.utcnow()
        db.commit()
        try:
            upsert_analysis_row(
                analysis_id=job.id,
                source_type="upload",
                source_url="",
                title=job.original_filename,
                video_storage_path=storage_path,
                duration_sec=int(job.duration_sec or 0),
                status=job.status.value,
                stage=job.stage,
                progress=float(job.progress or 0.0),
            )
        except Exception:
            pass

        ensure_dir(str(Path(job.video_path).parent))
        blob = download_file_from_storage(storage_path=storage_path)
        Path(job.video_path).write_bytes(blob)

        dur = probe_duration_sec(job.video_path, ffprobe_bin=settings.ffprobe_bin)
        job.duration_sec = int(dur or 0)
        job.stage = "queued"
        job.progress = 0.05
        job.updated_at = datetime.utcnow()
        db.commit()
        try:
            upsert_analysis_row(
                analysis_id=job.id,
                source_type="upload",
                source_url="",
                title=job.original_filename,
                video_storage_path=storage_path,
                duration_sec=int(job.duration_sec or 0),
                status="queued",
                stage="queued",
                progress=0.05,
            )
        except Exception:
            pass

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
                    source_type="upload",
                    source_url="",
                    title=job.original_filename,
                    video_storage_path=storage_path,
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

