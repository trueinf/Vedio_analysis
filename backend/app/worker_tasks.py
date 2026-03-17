from __future__ import annotations

import json
import traceback
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Job, JobStatus
from app.settings import settings
from app.utils.files import ensure_dir
from app.pipeline.media import extract_audio_wav, normalize_video
from app.orchestrator import Orchestrator
from app.models import Feedback, Metrics, Video


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

        job_dir = Path(settings.artifacts_dir) / job.id
        ensure_dir(job_dir)

        normalized = str(job_dir / "normalized.mp4")
        wav_path = str(job_dir / "audio_16k.wav")

        job.stage = "preprocessing"
        job.progress = 0.1
        job.updated_at = datetime.utcnow()
        db.commit()

        normalize_video(job.video_path, normalized, ffmpeg_bin=settings.ffmpeg_bin)
        extract_audio_wav(normalized, wav_path, ffmpeg_bin=settings.ffmpeg_bin, sr=16000)
        orch = Orchestrator()
        result = {"job_id": job.id, **orch.run(db, job, normalized_video=normalized, wav_path=wav_path)}

        out_path = Path(settings.results_dir) / f"{job.id}.json"
        out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

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
    except Exception as e:
        job = db.get(Job, job_id)
        if job:
            job.status = JobStatus.failed
            job.error_message = f"{e}\n{traceback.format_exc()}"
            job.updated_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()

