from __future__ import annotations

import json
import traceback
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Job, JobStatus
from app.settings import settings
from app.utils.files import ensure_dir
from app.pipeline.media import extract_audio_wav, normalize_video
from app.orchestrator import Orchestrator
from app.models import Feedback, Metrics, Video, YouTubeVideo, YouTubeVideoStatus
from app.supabase_repo import update_analysis_status, put_result_json
from app.supabase_client import update_analysis_status as sb_update_analysis_status


def _ensure_local_upload_file(job: Job) -> str:
    """
    API and worker often run as separate Railway services: uploads land on the API disk only.
    If the file is missing locally, download from Supabase Storage (same path used on upload).
    """
    path = Path(job.video_path)
    if path.is_file():
        return str(path)

    path.parent.mkdir(parents=True, exist_ok=True)
    candidates: list[str] = []
    try:
        from app.supabase_client import get_analysis_by_job_id

        row = get_analysis_by_job_id(job.id)
        if row:
            vp = (row.get("video_storage_path") or "").strip().lstrip("/")
            if vp:
                candidates.append(vp)
    except Exception:
        pass
    # Default upload layout: {job_id}/{safe_filename}
    candidates.append(f"{job.id}/{job.original_filename}")

    uniq: list[str] = []
    seen: set[str] = set()
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            uniq.append(c)

    from app.supabase_repo import _configured, download_file_from_storage

    if not _configured():
        raise FileNotFoundError(
            f"Video file not found at {job.video_path}. The worker runs on a different host than the API; "
            "set SUPABASE_URL + service key on the worker and ensure uploads mirror to Storage, or colocate API+worker."
        )

    last_err: Exception | None = None
    for sp in uniq:
        try:
            data = download_file_from_storage(storage_path=sp)
            path.write_bytes(data)
            print(f"[worker] Fetched upload from Supabase Storage ({sp}) -> {path}")
            return str(path)
        except Exception as e:
            last_err = e
    raise FileNotFoundError(
        f"Video not found locally at {job.video_path} and could not download from Supabase "
        f"(tried {uniq}): {last_err}"
    ) from last_err


def process_job(job_id: str) -> None:
    ensure_dir(settings.artifacts_dir)
    ensure_dir(settings.results_dir)

    db: Session = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.processing
        job.stage = "starting"
        job.progress = 0.05
        job.updated_at = datetime.utcnow()
        db.commit()
        update_analysis_status(analysis_id=job.id, status=job.status.value, stage=job.stage, progress=job.progress)
        sb_update_analysis_status(job_id=job.id, status=job.status.value, stage=job.stage, progress=job.progress)

        job_dir = Path(settings.artifacts_dir) / job.id
        ensure_dir(job_dir)

        normalized = str(job_dir / "normalized.mp4")
        wav_path = str(job_dir / "audio_16k.wav")

        job.stage = "preprocessing"
        job.progress = 0.1
        job.updated_at = datetime.utcnow()
        db.commit()
        update_analysis_status(analysis_id=job.id, status=job.status.value, stage=job.stage, progress=job.progress)
        sb_update_analysis_status(job_id=job.id, status=job.status.value, stage=job.stage, progress=job.progress)

        local_video = _ensure_local_upload_file(job)
        normalize_video(local_video, normalized, ffmpeg_bin=settings.ffmpeg_bin)
        extract_audio_wav(normalized, wav_path, ffmpeg_bin=settings.ffmpeg_bin, sr=16000)
        orch = Orchestrator()
        result = {"job_id": job.id, **orch.run(db, job, normalized_video=normalized, wav_path=wav_path)}

        out_path = Path(settings.results_dir) / f"{job.id}.json"
        out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

        # Dual-write completed result to Supabase (new schema) before finalizing SQLite job status.
        from app.supabase_client import store_completed_analysis

        channel = ""
        try:
            from app.models import Collection, Channel

            coll = db.get(Collection, job.collection_id)
            if coll:
                ch = db.get(Channel, coll.channel_id)
                if ch:
                    channel = ch.name
        except Exception:
            pass
        store_completed_analysis(
            job_id=job.id,
            result=result,
            original_filename=job.original_filename,
            duration_sec=job.duration_sec,
            channel_name=channel,
        )

        # Persist normalized data model (Video/Metrics/Feedback)
        now = datetime.utcnow()
        vid = db.get(Video, job.id)
        if not vid:
            vid = Video(
                id=job.id,
                created_at=now,
                original_filename=job.original_filename,
                video_path=job.video_path,
                duration_sec=job.duration_sec,
            )
            db.add(vid)
            db.commit()

        db.add(Metrics(video_id=job.id, created_at=now, metrics_json=json.dumps(result.get("cards", {}))))
        fb = result.get("feedback", {}) or {}
        fb_text = "\n".join([*(fb.get("strengths") or []), "", *(fb.get("suggestions") or [])]).strip()
        db.add(Feedback(video_id=job.id, created_at=now, feedback_text=fb_text))
        db.commit()

        job.status = JobStatus.completed
        job.stage = "completed"
        job.progress = 1.0
        job.result_path = str(out_path)
        job.updated_at = datetime.utcnow()
        db.commit()
        put_result_json(analysis_id=job.id, result=result)
        update_analysis_status(analysis_id=job.id, status=job.status.value, stage=job.stage, progress=job.progress)
        sb_update_analysis_status(job_id=job.id, status=job.status.value, stage=job.stage, progress=job.progress)

        # If this job belongs to a YouTube ingest, reflect status.
        ytv = db.execute(select(YouTubeVideo).where(YouTubeVideo.job_id == job.id)).scalar_one_or_none()
        if ytv:
            ytv.status = YouTubeVideoStatus.completed
            ytv.updated_at = datetime.utcnow()
            db.commit()
    except Exception as e:
        job = db.get(Job, job_id)
        if job:
            job.status = JobStatus.failed
            job.error_message = f"{e}\n{traceback.format_exc()}"
            job.updated_at = datetime.utcnow()
            db.commit()
            update_analysis_status(
                analysis_id=job.id,
                status=job.status.value,
                stage=(job.stage or "failed"),
                progress=float(job.progress or 0.0),
                error_message=job.error_message,
            )
            sb_update_analysis_status(
                job_id=job.id,
                status=job.status.value,
                stage=(job.stage or "failed"),
                progress=float(job.progress or 0.0),
                error=job.error_message,
            )
        ytv = db.execute(select(YouTubeVideo).where(YouTubeVideo.job_id == job_id)).scalar_one_or_none()
        if ytv:
            ytv.status = YouTubeVideoStatus.failed
            ytv.error_message = f"{e}\n{traceback.format_exc()}"
            ytv.updated_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()

