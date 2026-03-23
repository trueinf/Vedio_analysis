from __future__ import annotations

import json
import statistics
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, select, text

from app.db import Base, engine, get_db
from app.models import Channel, Collection, Job, JobStatus
from app.migrations import ensure_agent_tables, ensure_job_progress_columns
from app.schemas import (
    BatchUploadResponse,
    ChannelCollectionOut,
    ChannelCollectionsOut,
    ChannelItemOut,
    ChannelListOut,
    ChannelRenameIn,
    CollectionSummaryOut,
    HealthOut,
    JobCreateResponse,
    JobOut,
    JobResultOut,
    UploadResponse,
)
from app.settings import settings
from app.utils.files import ensure_dir, safe_filename
from app.worker_queue import enqueue_job
from app.video_meta import probe_duration_sec


def _suggest_channel_name(filenames: list[str]) -> tuple[str, str]:
    # Lightweight heuristic from filename stem, e.g. "ifan_vlog_01.mp4" -> "ifan"
    if not filenames:
        return ("creator", "low")
    first = Path(filenames[0]).stem.lower()
    cleaned = re.sub(r"[^a-z0-9_\-\s]", " ", first)
    tokens = [t for t in re.split(r"[\s_\-]+", cleaned) if t]
    stop = {"video", "vlog", "short", "shorts", "clip", "final", "edit", "upload", "youtube", "yt", "part", "ep"}
    candidates = [t for t in tokens if t not in stop and not t.isdigit()]
    if not candidates:
        return ("creator", "low")
    name = candidates[0][:32]
    return (name, "medium")


def _get_or_create_channel(db: Session, channel_name: str) -> Channel:
    normalized = (channel_name or "").strip()
    if not normalized:
        normalized = "creator"
    existing = db.execute(select(Channel).where(func.lower(Channel.name) == normalized.lower())).scalar_one_or_none()
    if existing:
        return existing
    ch = Channel(id=str(uuid.uuid4()), created_at=datetime.utcnow(), name=normalized)
    db.add(ch)
    db.commit()
    return ch


def _band(metric: str, value: float | str | None) -> str:
    if value is None:
        return "unknown"
    if metric == "speech_rate":
        v = float(value)
        if v < 95:
            return "slow"
        if v > 160:
            return "fast"
        return "normal"
    if metric == "fillers":
        v = float(value)
        if v <= 2:
            return "low"
        if v <= 5:
            return "moderate"
        return "high"
    if metric == "eye_contact":
        v = float(value)
        if v < 0.3:
            return "low"
        if v < 0.5:
            return "decent"
        return "good"
    if metric == "gestures":
        v = float(value)
        if v < 4:
            return "low"
        if v <= 20:
            return "normal"
        return "high"
    if metric == "expressions":
        v = float(value)
        if v < 20:
            return "low"
        if v <= 60:
            return "normal"
        return "high"
    if metric == "tonal":
        s = str(value).lower()
        if "express" in s:
            return "expressive"
        if "moderate" in s or "high variation" in s:
            return "moderate"
        if "monotone" in s:
            return "monotone"
        if "flat" in s:
            return "flat"
        return s
    return "unknown"


def _collection_summary(jobs: list[Job]) -> dict:
    completed = [j for j in jobs if j.status == JobStatus.completed and j.result_path and Path(j.result_path).exists()]
    results: list[dict] = []
    for j in completed:
        try:
            results.append(json.loads(Path(j.result_path).read_text(encoding="utf-8")))
        except Exception:
            continue

    failed_job_ids = [j.id for j in jobs if j.status == JobStatus.failed]

    if not results:
        return {
            "common_patterns": {},
            "consistency": {},
            "recurring_strengths": [],
            "recurring_issues": [],
            "best_video": None,
            "worst_video": None,
            "per_video": [],
            "failed_job_ids": failed_job_ids,
        }

    metric_values = {
        "speech_rate": [],
        "fillers": [],
        "eye_contact": [],
        "gestures": [],
        "expressions": [],
        "tonal": [],
    }
    score_by_video: list[tuple[str, float]] = []
    per_video: list[dict] = []
    for r in results:
        cards = r.get("cards", {}) or {}
        jid = str(r.get("job_id", ""))
        metric_values["speech_rate"].append(cards.get("speech_rate", {}).get("wpm"))
        metric_values["fillers"].append(cards.get("filler_words", {}).get("per_minute"))
        metric_values["eye_contact"].append(cards.get("eye_contact", {}).get("on_camera_ratio"))
        metric_values["gestures"].append(cards.get("gestures", {}).get("per_minute"))
        expr = cards.get("expressions", {}).get("change_count")
        dur = float((r.get("summary", {}) or {}).get("duration_sec") or 0.0)
        metric_values["expressions"].append((float(expr) / (dur / 60.0)) if expr is not None and dur > 0 else None)
        metric_values["tonal"].append((cards.get("tonal_variation", {}) or {}).get("label"))
        score = float((r.get("summary", {}) or {}).get("overall_score") or 0.0)
        score_by_video.append((jid, score))

        # Per-video contribution summary (what stood out most for this video)
        b_speech = _band("speech_rate", cards.get("speech_rate", {}).get("wpm"))
        b_fill = _band("fillers", cards.get("filler_words", {}).get("per_minute"))
        b_eye = _band("eye_contact", cards.get("eye_contact", {}).get("on_camera_ratio"))
        b_gesture = _band("gestures", cards.get("gestures", {}).get("per_minute"))
        b_tonal = _band("tonal", (cards.get("tonal_variation", {}) or {}).get("label"))
        bands = {
            "speech_rate": b_speech,
            "fillers": b_fill,
            "eye_contact": b_eye,
            "gestures": b_gesture,
            "tonal": b_tonal,
        }
        issue = next((f"{k}:{v}" for k, v in bands.items() if v in ("high", "low", "fast", "slow", "monotone", "flat")), "none")
        strength = next((f"{k}:{v}" for k, v in bands.items() if v in ("normal", "good", "expressive", "moderate", "decent")), "none")
        per_video.append({"job_id": jid, "score": round(score, 1), "key_issue": issue, "key_strength": strength})

    common_patterns: dict[str, dict] = {}
    consistency: dict[str, dict] = {}
    issue_counts: dict[str, int] = {}
    strength_counts: dict[str, int] = {}
    for key, values in metric_values.items():
        bands = [_band(key, v) for v in values if v is not None]
        freq: dict[str, int] = {}
        for b in bands:
            freq[b] = freq.get(b, 0) + 1
        if freq:
            top_label = max(freq, key=freq.get)
            top_count = freq[top_label]
            common_patterns[key] = {
                "most_common": top_label,
                "count": top_count,
                "share": round(top_count / len(bands), 3) if bands else 0.0,
                "distribution": freq,
            }
            for b, n in freq.items():
                if b in ("high", "low", "fast", "slow", "monotone", "flat"):
                    issue_counts[f"{key}:{b}"] = issue_counts.get(f"{key}:{b}", 0) + n
                if b in ("normal", "good", "expressive", "moderate", "decent"):
                    strength_counts[f"{key}:{b}"] = strength_counts.get(f"{key}:{b}", 0) + n
        numeric = [float(v) for v in values if isinstance(v, (int, float))]
        if numeric:
            consistency[key] = {
                "mean": round(statistics.fmean(numeric), 3),
                "min": round(min(numeric), 3),
                "max": round(max(numeric), 3),
                "std": round(statistics.pstdev(numeric), 3) if len(numeric) > 1 else 0.0,
            }
        else:
            consistency[key] = {"mean": None, "min": None, "max": None, "std": None}

    score_by_video = [x for x in score_by_video if x[0]]
    best_video = max(score_by_video, key=lambda x: x[1])[0] if score_by_video else None
    worst_video = min(score_by_video, key=lambda x: x[1])[0] if score_by_video else None

    recurring_issues = sorted(
        [{"pattern": k, "count": v} for k, v in issue_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:5]
    recurring_strengths = sorted(
        [{"pattern": k, "count": v} for k, v in strength_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:5]

    return {
        "common_patterns": common_patterns,
        "consistency": consistency,
        "recurring_strengths": recurring_strengths,
        "recurring_issues": recurring_issues,
        "best_video": best_video,
        "worst_video": worst_video,
        "per_video": per_video,
        "failed_job_ids": failed_job_ids,
    }


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
    async def upload_video(
        file: UploadFile = File(...),
        channel_name: str = Form(""),
        db: Session = Depends(get_db),
    ) -> UploadResponse:
        if not file:
            raise HTTPException(status_code=400, detail="file is required")
        job_id = str(uuid.uuid4())
        original = safe_filename(file.filename or "upload.mp4")
        suggested, conf = _suggest_channel_name([original])
        final_channel = channel_name.strip() or suggested
        channel = _get_or_create_channel(db, final_channel)
        collection_id = str(uuid.uuid4())
        collection = Collection(
            id=collection_id,
            created_at=datetime.utcnow(),
            channel_id=channel.id,
            title=f"{channel.name} single upload",
        )
        db.add(collection)
        db.commit()
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
            collection_id=collection_id,
            duration_sec=duration,
        )
        db.add(job)
        db.commit()

        enqueue_job(job_id)
        return UploadResponse(
            job_id=job_id,
            status=job.status.value,
            collection_id=collection_id,
            channel_id=channel.id,
            channel_name=channel.name,
            suggested_channel_name=suggested,
            suggestion_confidence=conf,
        )

    @app.post("/api/jobs/upload/batch", response_model=BatchUploadResponse)
    async def upload_videos(
        files: list[UploadFile] = File(...),
        channel_name: str = Form(""),
        collection_title: str = Form(""),
        db: Session = Depends(get_db),
    ) -> BatchUploadResponse:
        if not files:
            raise HTTPException(status_code=400, detail="files are required")
        out: list[UploadResponse] = []
        originals = [safe_filename(f.filename or "upload.mp4") for f in files]
        suggested, conf = _suggest_channel_name(originals)
        final_channel = channel_name.strip() or suggested
        channel = _get_or_create_channel(db, final_channel)
        collection_id = str(uuid.uuid4())
        coll = Collection(
            id=collection_id,
            created_at=datetime.utcnow(),
            channel_id=channel.id,
            title=(collection_title or f"{channel.name} batch").strip(),
        )
        db.add(coll)
        db.commit()
        now = datetime.utcnow()
        for file, original in zip(files, originals):
            job_id = str(uuid.uuid4())
            ext = Path(original).suffix or ".mp4"
            dest = Path(settings.uploads_dir) / f"{job_id}{ext}"

            with dest.open("wb") as f:
                while True:
                    chunk = await file.read(1024 * 1024 * 8)
                    if not chunk:
                        break
                    f.write(chunk)

            duration = probe_duration_sec(str(dest), ffprobe_bin=settings.ffprobe_bin)
            job = Job(
                id=job_id,
                created_at=now,
                updated_at=now,
                status=JobStatus.queued,
                original_filename=original,
                video_path=str(dest),
                collection_id=collection_id,
                duration_sec=duration,
            )
            db.add(job)
            db.commit()
            enqueue_job(job_id)
            out.append(
                UploadResponse(
                    job_id=job_id,
                    status=job.status.value,
                    collection_id=collection_id,
                    channel_id=channel.id,
                    channel_name=channel.name,
                    suggested_channel_name=suggested,
                    suggestion_confidence=conf,
                )
            )
        return BatchUploadResponse(
            jobs=out,
            collection_id=collection_id,
            channel_id=channel.id,
            channel_name=channel.name,
            suggested_channel_name=suggested,
            suggestion_confidence=conf,
            message=f"uploaded {len(out)} file(s)",
        )

    @app.get("/api/collections/{collection_id}/summary", response_model=CollectionSummaryOut)
    def get_collection_summary(collection_id: str, db: Session = Depends(get_db)) -> CollectionSummaryOut:
        jobs = list(db.execute(select(Job).where(Job.collection_id == collection_id)).scalars().all())
        if not jobs:
            raise HTTPException(status_code=404, detail="collection not found")
        total = len(jobs)
        completed = len([j for j in jobs if j.status == JobStatus.completed])
        failed = len([j for j in jobs if j.status == JobStatus.failed])
        processing = len([j for j in jobs if j.status in (JobStatus.queued, JobStatus.processing)])
        summary = _collection_summary(jobs)
        return CollectionSummaryOut(
            collection_id=collection_id,
            total_videos=total,
            completed_videos=completed,
            failed_videos=failed,
            processing_videos=processing,
            summary=summary,
        )

    @app.get("/api/channels", response_model=ChannelListOut)
    def list_channels(db: Session = Depends(get_db)) -> ChannelListOut:
        channels = list(db.execute(select(Channel).order_by(Channel.created_at.desc())).scalars().all())
        out: list[ChannelItemOut] = []
        for ch in channels:
            collections = list(
                db.execute(select(Collection).where(Collection.channel_id == ch.id).order_by(Collection.created_at.desc()))
                .scalars()
                .all()
            )
            collection_ids = [c.id for c in collections]
            videos = (
                int(db.execute(select(func.count()).select_from(Job).where(Job.collection_id.in_(collection_ids))).scalar() or 0)
                if collection_ids
                else 0
            )
            out.append(
                ChannelItemOut(
                    id=ch.id,
                    name=ch.name,
                    collections=len(collections),
                    videos=videos,
                    latest_collection_id=collections[0].id if collections else "",
                )
            )
        return ChannelListOut(channels=out)

    @app.get("/api/channels/{channel_id}/collections", response_model=ChannelCollectionsOut)
    def channel_collections(channel_id: str, db: Session = Depends(get_db)) -> ChannelCollectionsOut:
        ch = db.get(Channel, channel_id)
        if not ch:
            raise HTTPException(status_code=404, detail="channel not found")
        collections = list(
            db.execute(select(Collection).where(Collection.channel_id == channel_id).order_by(Collection.created_at.desc()))
            .scalars()
            .all()
        )
        out: list[ChannelCollectionOut] = []
        for c in collections:
            jobs = list(db.execute(select(Job).where(Job.collection_id == c.id)).scalars().all())
            total = len(jobs)
            completed = len([j for j in jobs if j.status == JobStatus.completed])
            failed = len([j for j in jobs if j.status == JobStatus.failed])
            out.append(
                ChannelCollectionOut(
                    collection_id=c.id,
                    title=c.title or "",
                    created_at=c.created_at,
                    total_videos=total,
                    completed_videos=completed,
                    failed_videos=failed,
                )
            )
        return ChannelCollectionsOut(channel_id=ch.id, channel_name=ch.name, collections=out)

    @app.patch("/api/channels/{channel_id}", response_model=ChannelItemOut)
    def rename_channel(channel_id: str, payload: ChannelRenameIn, db: Session = Depends(get_db)) -> ChannelItemOut:
        ch = db.get(Channel, channel_id)
        if not ch:
            raise HTTPException(status_code=404, detail="channel not found")
        new_name = (payload.name or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="channel name is required")
        exists = db.execute(
            select(Channel).where(func.lower(Channel.name) == new_name.lower(), Channel.id != channel_id)
        ).scalar_one_or_none()
        if exists:
            raise HTTPException(status_code=409, detail="channel name already exists")
        ch.name = new_name
        db.commit()
        collections = list(db.execute(select(Collection).where(Collection.channel_id == ch.id)).scalars().all())
        collection_ids = [c.id for c in collections]
        videos = (
            int(db.execute(select(func.count()).select_from(Job).where(Job.collection_id.in_(collection_ids))).scalar() or 0)
            if collection_ids
            else 0
        )
        latest = (
            db.execute(select(Collection).where(Collection.channel_id == ch.id).order_by(Collection.created_at.desc()))
            .scalars()
            .first()
        )
        return ChannelItemOut(
            id=ch.id,
            name=ch.name,
            collections=len(collections),
            videos=videos,
            latest_collection_id=latest.id if latest else "",
        )

    @app.delete("/api/channels/{channel_id}")
    def delete_channel(channel_id: str, db: Session = Depends(get_db)) -> dict:
        ch = db.get(Channel, channel_id)
        if not ch:
            raise HTTPException(status_code=404, detail="channel not found")
        collections = list(db.execute(select(Collection).where(Collection.channel_id == channel_id)).scalars().all())
        collection_ids = [c.id for c in collections]
        if collection_ids:
            jobs = list(db.execute(select(Job).where(Job.collection_id.in_(collection_ids))).scalars().all())
            for j in jobs:
                db.delete(j)
            for c in collections:
                db.delete(c)
        db.delete(ch)
        db.commit()
        return {"ok": True, "deleted_channel_id": channel_id}

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

