from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db import Base, engine, get_db
from app.models import Job, JobStatus
from app.migrations import ensure_agent_tables, ensure_job_progress_columns
from app.schemas import HealthOut, JobCreateResponse, JobOut, JobResultOut, UploadResponse
from app.settings import settings
from app.utils.files import ensure_dir, safe_filename
from app.worker_queue import enqueue_job
from app.video_meta import probe_duration_sec


def create_app() -> FastAPI:
    ensure_dir(settings.data_dir)
    ensure_dir(settings.models_dir)
    Base.metadata.create_all(bind=engine)
    ensure_job_progress_columns(engine)
    ensure_agent_tables(engine)
    ensure_dir(settings.uploads_dir)
    ensure_dir(settings.artifacts_dir)
    ensure_dir(settings.results_dir)

    app = FastAPI(default_response_class=ORJSONResponse, title=settings.app_name)

    # Best-effort recovery: if the server was restarted mid-job (thread-based worker),
    # move stale processing jobs back to queued so they can be retried.
    try:
        with engine.begin() as c:
            c.execute(
                text(
                    "UPDATE jobs "
                    "SET status='queued', stage='queued', progress=0.0 "
                    "WHERE status='processing' AND (result_path IS NULL OR result_path='')"
                )
            )
    except Exception:
        pass

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthOut)
    def health() -> HealthOut:
        return HealthOut()

    @app.post("/api/jobs/upload", response_model=UploadResponse)
    async def upload_video(file: UploadFile = File(...), db: Session = Depends(get_db)) -> UploadResponse:
        job_id = str(uuid.uuid4())
        original = safe_filename(file.filename or "upload.mp4")
        ext = Path(original).suffix or ".mp4"
        dest = Path(settings.uploads_dir) / f"{job_id}{ext}"

        # Stream to disk to support multi-GB uploads (3h videos).
        with dest.open("wb") as f:
            while True:
                chunk = await file.read(1024 * 1024 * 8)  # 8MB
                if not chunk:
                    break
                f.write(chunk)

        duration = probe_duration_sec(str(dest), ffprobe_bin=settings.ffprobe_bin)

        now = datetime.utcnow()
        job = Job(
            id=job_id,
            created_at=now,
            updated_at=now,
            status=JobStatus.queued,
            original_filename=original,
            video_path=str(dest),
            duration_sec=duration,
        )
        db.add(job)
        db.commit()

        enqueue_job(job_id)
        return UploadResponse(job_id=job_id, status=job.status.value)

    @app.get("/api/jobs/{job_id}", response_model=JobCreateResponse)
    def get_job(job_id: str, db: Session = Depends(get_db)) -> JobCreateResponse:
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        out = JobOut(
            id=job.id,
            status=job.status.value,
            created_at=job.created_at,
            updated_at=job.updated_at,
            original_filename=job.original_filename,
            duration_sec=job.duration_sec,
            stage=getattr(job, "stage", "queued") or "queued",
            progress=float(getattr(job, "progress", 0.0) or 0.0),
            error_message=job.error_message or "",
        )
        return JobCreateResponse(job=out)

    @app.get("/api/jobs/{job_id}/result", response_model=JobResultOut)
    def get_result(job_id: str, db: Session = Depends(get_db)) -> JobResultOut:
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        if job.status != JobStatus.completed:
            raise HTTPException(status_code=409, detail=f"job not completed (status={job.status.value})")
        if not job.result_path or not Path(job.result_path).exists():
            raise HTTPException(status_code=500, detail="result missing")

        data = Path(job.result_path).read_bytes()
        result = json.loads(data)
        return JobResultOut(job_id=job.id, result=result)

    @app.post("/api/jobs/{job_id}/retry", response_model=UploadResponse)
    def retry_job(job_id: str, db: Session = Depends(get_db)) -> UploadResponse:
        job = db.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        job.status = JobStatus.queued
        job.stage = "queued"
        job.progress = 0.0
        job.error_message = ""
        job.result_path = ""
        job.updated_at = datetime.utcnow()
        db.commit()
        enqueue_job(job_id)
        return UploadResponse(job_id=job_id, status=job.status.value, message="retried")

    return app


app = create_app()

