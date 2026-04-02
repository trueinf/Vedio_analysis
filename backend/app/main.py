from __future__ import annotations

import json
import statistics
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import ORJSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, select, text

from app.db import Base, engine, get_db
from app.models import (
    Channel,
    Collection,
    Job,
    JobStatus,
    YouTubeChannel,
    YouTubeIngest,
    YouTubeIngestStatus,
    YouTubeVideo,
    YouTubeVideoStatus,
)
from app.migrations import ensure_agent_tables, ensure_job_progress_columns, ensure_youtube_tables
from app.comparison_engine import benchmark_from_results, build_comparison_report
from app.schemas import (
    BatchUploadResponse,
    ComparisonIn,
    ComparisonOut,
    ChannelCollectionOut,
    ChannelCollectionsOut,
    ChannelItemOut,
    ChannelListOut,
    ChannelRenameIn,
    CollectionSummaryOut,
    HealthOut,
    JobCreateResponse,
    JobHistoryItemOut,
    JobHistoryOut,
    JobOut,
    JobResultOut,
    UploadResponse,
    YouTubeIngestCreateIn,
    YouTubeIngestCreateOut,
    YouTubeIngestStatusOut,
    YouTubeJobIn,
    SupabaseStorageJobIn,
    FastUploadResponse,
    UploadRegisterIn,
)
from app.settings import settings
from app.utils.files import ensure_dir, safe_filename
from app.worker_queue import enqueue_job, enqueue_task
from app.supabase_repo import (
    upsert_analysis_row,
    upload_file_to_storage,
    put_result_json,
    list_analyses,
    get_analysis,
    get_result,
    create_comparison_report,
    ensure_bucket_exists,
    create_signed_upload_url,
    create_signed_download_url,
)
from app.services.file_service import build_local_upload_path
from app.youtube_service import normalize_channel_handle


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


async def _upload_multipart_core(
    file: UploadFile,
    channel_name: str,
    db: Session,
) -> UploadResponse:
    """
    Stream upload to disk, mirror to Supabase Storage, enqueue worker.
    Duration is probed in the worker (keeps HTTP fast for large files).
    """
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
    dest = build_local_upload_path(job_id, original)

    with dest.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024 * 8)
            if not chunk:
                break
            f.write(chunk)

    duration = 0
    storage_path = f"{job_id}/{original}"
    storage_ok = False
    try:
        upload_file_to_storage(local_path=str(dest), storage_path=storage_path, content_type=file.content_type)
        storage_ok = True
    except Exception:
        pass
    try:
        upsert_analysis_row(
            analysis_id=job_id,
            source_type="upload",
            source_url="",
            title=original,
            video_storage_path=storage_path if storage_ok else "",
            duration_sec=int(duration or 0),
            status="queued",
            stage="queued",
            progress=0.0,
        )
    except Exception:
        pass

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


def create_app() -> FastAPI:
    ensure_dir(settings.data_dir)
    ensure_dir(settings.models_dir)
    Base.metadata.create_all(bind=engine)
    ensure_job_progress_columns(engine)
    ensure_agent_tables(engine)
    ensure_youtube_tables(engine)
    ensure_dir(settings.uploads_dir)
    ensure_dir(settings.artifacts_dir)
    ensure_dir(settings.results_dir)
    ensure_dir(settings.clips_dir)

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

    if settings.cors_allow_all:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_origin_regex=None,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        cors_origins = [o.strip() for o in (settings.cors_origins or "").split(",") if o.strip()]
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_origin_regex=(settings.cors_origin_regex or None),
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/health", response_model=HealthOut)
    def health() -> HealthOut:
        return HealthOut()

    @app.post("/api/supabase/storage/ensure-bucket")
    def supabase_ensure_bucket() -> dict:
        # Uses backend service role key; safe to call from frontend.
        ensure_bucket_exists(settings.supabase_bucket)
        return {
            "ok": True,
            "bucket": settings.supabase_bucket,
            "file_size_limit_bytes": settings.supabase_bucket_file_size_limit_bytes,
        }

    @app.post("/api/supabase/storage/signed-upload-url")
    def supabase_signed_upload_url(payload: dict) -> dict:
        """
        Create a signed upload URL for client-side upload without Storage RLS policies.
        Payload: { path: string, bucket?: string }
        """
        path = str(payload.get("path") or "").strip()
        bucket = str(payload.get("bucket") or settings.supabase_bucket).strip()
        if not path:
            raise HTTPException(status_code=400, detail="path is required")
        out = create_signed_upload_url(bucket=bucket, path=path)
        if not out.get("signed_url") or not out.get("token"):
            raise HTTPException(status_code=500, detail="failed to create signed upload url")
        return {"bucket": bucket, **out}

    @app.post("/api/supabase/storage/signed-download-url")
    def supabase_signed_download_url(payload: dict) -> dict:
        """
        Create a signed download URL for client-side playback.
        Payload: { path: string, bucket?: string, expires_in_sec?: number }
        """
        path = str(payload.get("path") or "").strip()
        bucket = str(payload.get("bucket") or settings.supabase_bucket).strip()
        expires = int(payload.get("expires_in_sec") or 3600)
        if not path:
            raise HTTPException(status_code=400, detail="path is required")
        out = create_signed_download_url(bucket=bucket, path=path, expires_in_sec=expires)
        if not out.get("signed_url"):
            raise HTTPException(status_code=500, detail="failed to create signed download url")
        return {"bucket": bucket, **out}

    # Netlify / misconfigured clients sometimes POST to `/upload` instead of `/api/jobs/upload`.
    @app.post("/api/jobs/upload", response_model=UploadResponse)
    @app.post("/upload", response_model=UploadResponse, include_in_schema=False)
    async def upload_video(
        file: UploadFile = File(...),
        channel_name: str = Form(""),
        db: Session = Depends(get_db),
    ) -> UploadResponse:
        return await _upload_multipart_core(file, channel_name, db)

    @app.post("/api/upload", response_model=FastUploadResponse)
    async def api_upload(
        request: Request,
        db: Session = Depends(get_db),
    ) -> FastUploadResponse:
        """
        Production upload: multipart file (streamed to disk + Storage) or JSON body for an existing Storage path.
        Returns immediately with queued analysis id — processing runs in the worker.
        """
        ct = (request.headers.get("content-type") or "").lower()
        if "application/json" in ct:
            body = UploadRegisterIn.model_validate(await request.json())
            storage_path = (body.storage_path or "").strip()
            if not storage_path:
                raise HTTPException(status_code=400, detail="storage_path is required")
            job_id = str(uuid.uuid4())
            original = safe_filename(body.original_filename or "upload.mp4")
            dest = build_local_upload_path(job_id, original)
            now = datetime.utcnow()
            job = Job(
                id=job_id,
                created_at=now,
                updated_at=now,
                status=JobStatus.queued,
                original_filename=original,
                video_path=str(dest),
                collection_id="",
                duration_sec=0,
                stage="queued",
                progress=0.0,
                error_message="",
                result_path="",
            )
            db.add(job)
            db.commit()
            try:
                upsert_analysis_row(
                    analysis_id=job_id,
                    source_type="upload",
                    source_url="",
                    title=original,
                    video_storage_path=storage_path,
                    duration_sec=0,
                    status="queued",
                    stage="queued",
                    progress=0.0,
                )
            except Exception:
                pass
            enqueue_task("app.supabase_storage_tasks.download_from_supabase_then_enqueue", job_id, storage_path)
            return FastUploadResponse(analysis_id=job_id, status="queued")

        form = await request.form()
        uf = form.get("file")
        channel_name = str(form.get("channel_name") or "")
        if not uf or not hasattr(uf, "read"):
            raise HTTPException(status_code=400, detail="file is required (multipart field 'file')")
        resp = await _upload_multipart_core(uf, channel_name, db)  # type: ignore[arg-type]
        return FastUploadResponse(analysis_id=resp.job_id, status="queued")

    # Path must not be `/api/jobs/youtube` — that collides with `GET /api/jobs/{job_id}` (job_id="youtube" → 405 on POST).
    @app.post("/api/jobs/from-youtube", response_model=UploadResponse)
    def create_job_from_youtube(payload: YouTubeJobIn, db: Session = Depends(get_db)) -> UploadResponse:
        url = (payload.url or "").strip()
        if not url:
            raise HTTPException(status_code=400, detail="url is required")
        low = url.lower()
        if ("youtube.com/@" in low) or low.rstrip("/").endswith("/@") or low.startswith("@") or ("/channel/" in low) or ("/c/" in low):
            raise HTTPException(
                status_code=400,
                detail="This looks like a channel link/handle. Use 'Specific channel → Build real benchmark' instead.",
            )
        if ("watch?v=" not in low) and ("youtu.be/" not in low) and ("/shorts/" not in low):
            raise HTTPException(status_code=400, detail="Please paste a YouTube video URL (watch?v=..., youtu.be/..., or /shorts/...)")

        job_id = str(uuid.uuid4())
        # Put under uploads/youtube-urls/<job_id>.mp4
        dest_dir = Path(settings.uploads_dir) / "youtube-urls"
        ensure_dir(dest_dir)
        dest = dest_dir / f"{job_id}.mp4"

        now = datetime.utcnow()
        job = Job(
            id=job_id,
            created_at=now,
            updated_at=now,
            status=JobStatus.queued,
            original_filename=f"youtube_url:{url[:220]}",
            video_path=str(dest),
            collection_id="",
            duration_sec=0,
            stage="queued",
            progress=0.0,
            error_message="",
            result_path="",
        )
        db.add(job)
        db.commit()
        try:
            upsert_analysis_row(
                analysis_id=job_id,
                source_type="youtube_url",
                source_url=url,
                title="YouTube URL",
                video_storage_path="",
                duration_sec=0,
                status="queued",
                stage="queued",
                progress=0.0,
            )
        except Exception:
            pass

        # Download async (then enqueue normal pipeline)
        enqueue_task("app.youtube_url_tasks.download_then_enqueue", job_id, url)
        return UploadResponse(job_id=job_id, status=job.status.value, message="youtube url queued")

    @app.post("/api/jobs/from-supabase", response_model=UploadResponse)
    def create_job_from_supabase(payload: SupabaseStorageJobIn, db: Session = Depends(get_db)) -> UploadResponse:
        storage_path = (payload.storage_path or "").strip()
        if not storage_path:
            raise HTTPException(status_code=400, detail="storage_path is required")

        job_id = str(uuid.uuid4())
        original = safe_filename(payload.original_filename or "upload.mp4")
        ext = Path(original).suffix or ".mp4"
        dest = Path(settings.uploads_dir) / f"{job_id}{ext}"

        now = datetime.utcnow()
        job = Job(
            id=job_id,
            created_at=now,
            updated_at=now,
            status=JobStatus.queued,
            original_filename=original,
            video_path=str(dest),
            collection_id="",
            duration_sec=0,
            stage="queued",
            progress=0.0,
            error_message="",
            result_path="",
        )
        db.add(job)
        db.commit()
        try:
            upsert_analysis_row(
                analysis_id=job_id,
                source_type="upload",
                source_url="",
                title=original,
                video_storage_path=storage_path,
                duration_sec=0,
                status="queued",
                stage="queued",
                progress=0.0,
            )
        except Exception:
            pass

        enqueue_task("app.supabase_storage_tasks.download_from_supabase_then_enqueue", job_id, storage_path)
        return UploadResponse(job_id=job_id, status=job.status.value, message="supabase upload queued")

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
            dest = build_local_upload_path(job_id, original)

            with dest.open("wb") as f:
                while True:
                    chunk = await file.read(1024 * 1024 * 8)
                    if not chunk:
                        break
                    f.write(chunk)

            duration = 0
            storage_path = f"{job_id}/{original}"
            try:
                upload_file_to_storage(local_path=str(dest), storage_path=storage_path, content_type=file.content_type)
                upsert_analysis_row(
                    analysis_id=job_id,
                    source_type="upload",
                    source_url="",
                    title=original,
                    video_storage_path=storage_path,
                    duration_sec=int(duration or 0),
                    status="queued",
                    stage="queued",
                    progress=0.0,
                )
            except Exception:
                pass
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

    @app.get("/api/analyses")
    def api_list_analyses(limit: int = 200) -> dict:
        rows = list_analyses(limit=limit)
        return {"analyses": rows}

    @app.get("/api/analyses/{analysis_id}")
    def api_get_analysis(analysis_id: str, db: Session = Depends(get_db)) -> dict:
        from app.supabase_client import get_analysis_by_job_id, get_result_json_for_job, list_events_for_analysis_uuid

        job = db.get(Job, analysis_id)
        row = get_analysis(analysis_id) or get_analysis_by_job_id(analysis_id)
        events: list = []
        if row and row.get("id"):
            events = list_events_for_analysis_uuid(str(row["id"]))
        result_json = get_result_json_for_job(analysis_id)
        if result_json is None and job and job.result_path and Path(job.result_path).exists():
            try:
                result_json = json.loads(Path(job.result_path).read_text(encoding="utf-8"))
            except Exception:
                result_json = None
        if not row and not job:
            raise HTTPException(status_code=404, detail="analysis not found")
        job_payload = None
        if job:
            p = float(job.progress or 0.0)
            job_payload = {
                "id": job.id,
                "status": job.status.value,
                "stage": job.stage,
                "progress": p,
                "progress_percent": max(0, min(100, int(round(p * 100)))),
                "original_filename": job.original_filename,
                "duration_sec": job.duration_sec,
                "error_message": job.error_message or "",
            }
        return {
            "analysis": row,
            "job": job_payload,
            "result_json": result_json,
            "events": events,
        }

    @app.get("/api/analyses/{analysis_id}/result")
    def api_get_analysis_result(analysis_id: str) -> dict:
        r = get_result(analysis_id)
        if not r:
            raise HTTPException(status_code=404, detail="analysis result not found (or Supabase not configured)")
        return {"result": r}

    # --- Supabase-backed API (Phase 1) ---

    @app.get("/api/supabase/analyses")
    def list_supabase_analyses(limit: int = 50, offset: int = 0, status: str = "") -> dict:
        from app.supabase_client import list_analyses as sb_list

        data = sb_list(limit=limit, offset=offset, status=status)
        return {"analyses": data, "count": len(data)}

    @app.get("/api/supabase/analyses/{job_id}")
    def get_supabase_analysis(job_id: str) -> dict:
        from app.supabase_client import get_analysis_by_job_id

        data = get_analysis_by_job_id(job_id)
        if not data:
            raise HTTPException(status_code=404, detail="analysis not found")
        return data

    @app.get("/api/supabase/analyses/{job_id}/full")
    def get_supabase_analysis_full(job_id: str) -> dict:
        from app.supabase_client import get_analysis_by_job_id

        data = get_analysis_by_job_id(job_id)
        if not data:
            raise HTTPException(status_code=404, detail="analysis not found")
        return {"analysis": data, "result": data.get("result_json", {})}

    @app.post("/api/supabase/comparisons")
    def create_supabase_comparison(payload: ComparisonIn, db: Session = Depends(get_db)) -> dict:
        # Fetch source result from Supabase
        from app.supabase_client import get_analysis_by_job_id, store_comparison, get_supabase_client

        source_data = get_analysis_by_job_id(payload.job_id)
        if not source_data or not source_data.get("result_json"):
            # fallback to file-based result
            job = db.get(Job, payload.job_id)
            if not job or job.status != JobStatus.completed:
                raise HTTPException(status_code=409, detail="source analysis not completed")
            import json as _json
            from pathlib import Path as _Path

            if not job.result_path or not _Path(job.result_path).exists():
                raise HTTPException(status_code=500, detail="result missing")
            result = _json.loads(_Path(job.result_path).read_text(encoding="utf-8"))
        else:
            result = source_data["result_json"]

        # Target analysis (optional)
        target_result = None
        target_job_id = None
        if payload.compare_mode == "specific_channel" and payload.competitor_channel.strip():
            client = get_supabase_client()
            if client:
                try:
                    target_res = (
                        client.table("analyses")
                        .select("job_id, result_json")
                        .eq("channel_name", payload.competitor_channel.strip())
                        .eq("status", "completed")
                        .order("created_at", desc=True)
                        .limit(1)
                        .execute()
                    )
                    if target_res.data:
                        target_job_id = target_res.data[0]["job_id"]
                        target_result = target_res.data[0]["result_json"]
                except Exception:
                    pass

        from app.comparison_engine import build_comparison_report, benchmark_from_results

        bench = benchmark_from_results([target_result]) if target_result else None
        report = build_comparison_report(
            result=result,
            compare_mode=payload.compare_mode,
            niche=payload.niche,
            competitor_channel=payload.competitor_channel,
            goal=payload.goal,
            platform=payload.platform,
            benchmark_override=bench,
            benchmark_label_override=payload.competitor_channel if target_result else None,
            benchmark_sample_size=1 if target_result else 0,
        )

        stored = store_comparison(
            source_job_id=payload.job_id,
            target_job_id=target_job_id,
            report=report,
            niche=payload.niche,
            goal=payload.goal,
            platform=payload.platform,
            compare_mode=payload.compare_mode,
            competitor_channel=payload.competitor_channel,
        )

        return {"report": report, "comparison_id": stored["id"] if stored else None}

    @app.get("/api/supabase/stats")
    def get_supabase_stats() -> dict:
        from app.supabase_client import get_supabase_client

        client = get_supabase_client()
        if not client:
            return {"error": "supabase not configured"}
        try:
            total = client.table("analyses").select("id", count="exact").execute()
            completed = client.table("analyses").select("id", count="exact").eq("status", "completed").execute()
            avg_res = (
                client.table("analyses")
                .select("overall_score, wpm, eye_contact_ratio, fillers_per_min, confidence_score, energy_score")
                .eq("status", "completed")
                .order("created_at", desc=True)
                .limit(500)
                .execute()
            )
            rows = avg_res.data or []

            def safe_avg(key: str) -> float:
                vals = [r[key] for r in rows if isinstance(r, dict) and r.get(key) is not None]
                return round(sum(vals) / len(vals), 2) if vals else 0.0

            return {
                "total_analyses": getattr(total, "count", 0) or 0,
                "completed_analyses": getattr(completed, "count", 0) or 0,
                "avg_overall_score": safe_avg("overall_score"),
                "avg_wpm": safe_avg("wpm"),
                "avg_eye_contact": safe_avg("eye_contact_ratio"),
                "avg_fillers_per_min": safe_avg("fillers_per_min"),
                "avg_confidence_score": safe_avg("confidence_score"),
                "avg_energy_score": safe_avg("energy_score"),
            }
        except Exception as e:
            return {"error": str(e)}

    @app.post("/api/compare/from-analyses")
    def api_compare_from_analyses(payload: dict) -> dict:
        """
        Build comparison report from two stored analyses.
        Payload: { left_analysis_id: str, right_analysis_id: str }
        """
        left_id = str(payload.get("left_analysis_id") or "").strip()
        right_id = str(payload.get("right_analysis_id") or "").strip()
        if not left_id or not right_id:
            raise HTTPException(status_code=400, detail="left_analysis_id and right_analysis_id are required")
        left = get_result(left_id)
        right = get_result(right_id)
        if not left or not right:
            raise HTTPException(status_code=404, detail="missing stored results for one or both analyses")
        # Reuse existing comparison_report logic by simulating a minimal benchmark payload.
        # We keep it deterministic: compare key summary/cards fields between the two results.
        report = {
            "left_analysis_id": left_id,
            "right_analysis_id": right_id,
            "generated_at": datetime.utcnow().isoformat(),
            "delta": {
                "overall_score": float((left.get("summary") or {}).get("overall_score") or 0)
                - float((right.get("summary") or {}).get("overall_score") or 0),
                "wpm": float(((left.get("cards") or {}).get("speech_rate") or {}).get("wpm") or 0)
                - float(((right.get("cards") or {}).get("speech_rate") or {}).get("wpm") or 0),
                "fillers_per_min": float(((left.get("cards") or {}).get("filler_words") or {}).get("per_minute") or 0)
                - float(((right.get("cards") or {}).get("filler_words") or {}).get("per_minute") or 0),
                "eye_contact": float(((left.get("cards") or {}).get("eye_contact") or {}).get("on_camera_ratio") or 0)
                - float(((right.get("cards") or {}).get("eye_contact") or {}).get("on_camera_ratio") or 0),
                "gestures_per_min": float(((left.get("cards") or {}).get("gestures") or {}).get("per_minute") or 0)
                - float(((right.get("cards") or {}).get("gestures") or {}).get("per_minute") or 0),
                "tonal_score": float((((left.get("cards") or {}).get("tonal_variation") or {}).get("score")) or 0)
                - float((((right.get("cards") or {}).get("tonal_variation") or {}).get("score")) or 0),
            },
            "left": {"summary": left.get("summary"), "cards": left.get("cards")},
            "right": {"summary": right.get("summary"), "cards": right.get("cards")},
        }
        rid = create_comparison_report(left_analysis_id=left_id, right_analysis_id=right_id, report=report)
        return {"comparison_report_id": rid, "report": report}

    @app.post("/api/compare")
    def api_compare(payload: dict) -> dict:
        """Alias for /api/compare/from-analyses with optional left_id/right_id keys."""
        left_id = str(
            payload.get("left_analysis_id") or payload.get("left_id") or payload.get("analysis_a") or ""
        ).strip()
        right_id = str(
            payload.get("right_analysis_id") or payload.get("right_id") or payload.get("analysis_b") or ""
        ).strip()
        if not left_id or not right_id:
            raise HTTPException(
                status_code=400,
                detail="left_analysis_id and right_analysis_id are required (or left_id / right_id)",
            )
        return api_compare_from_analyses({"left_analysis_id": left_id, "right_analysis_id": right_id})

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

    @app.get("/api/jobs", response_model=JobHistoryOut)
    def list_jobs(limit: int = 200, db: Session = Depends(get_db)) -> JobHistoryOut:
        lim = max(1, min(int(limit or 200), 1000))
        rows = list(db.execute(select(Job).order_by(Job.created_at.desc()).limit(lim)).scalars().all())
        out = [
            JobHistoryItemOut(
                id=j.id,
                created_at=j.created_at,
                updated_at=j.updated_at,
                status=j.status.value,
                stage=getattr(j, "stage", "queued") or "queued",
                progress=float(getattr(j, "progress", 0.0) or 0.0),
                original_filename=j.original_filename or "",
                duration_sec=int(j.duration_sec or 0),
                has_result=bool(j.result_path and Path(j.result_path).exists()),
            )
            for j in rows
        ]
        return JobHistoryOut(jobs=out)

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

    @app.get("/api/clips/{job_id}/{clip_name}")
    def get_clip(job_id: str, clip_name: str) -> FileResponse:
        safe = Path(clip_name).name
        if not safe or safe != clip_name:
            raise HTTPException(status_code=400, detail="invalid clip name")
        clip_path = Path(settings.clips_dir) / job_id / safe
        if not clip_path.exists() or not clip_path.is_file():
            raise HTTPException(status_code=404, detail="clip not found")
        return FileResponse(str(clip_path), media_type="video/mp4")

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

    @app.post("/api/comparison/report", response_model=ComparisonOut)
    def comparison_report(payload: ComparisonIn, db: Session = Depends(get_db)) -> ComparisonOut:
        job = db.get(Job, payload.job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        if job.status != JobStatus.completed:
            raise HTTPException(status_code=409, detail=f"job not completed (status={job.status.value})")
        if not job.result_path or not Path(job.result_path).exists():
            raise HTTPException(status_code=500, detail="result missing")
        result = json.loads(Path(job.result_path).read_text(encoding="utf-8"))
        bench_label = ""
        bench_rows: list[dict] = []

        yt_benchmark: dict | None = None
        yt_benchmark_label: str | None = None
        yt_benchmark_n: int = 0

        if payload.compare_mode == "specific_channel" and payload.competitor_channel.strip():
            # Prefer a real benchmark built from competitor channel videos (YouTube ingest).
            handle = normalize_channel_handle(payload.competitor_channel.strip())
            ytch = db.execute(select(YouTubeChannel).where(func.lower(YouTubeChannel.handle) == handle.lower())).scalar_one_or_none()
            if ytch and (ytch.last_benchmark_json or "").strip() and ytch.last_benchmark_json.strip() != "{}":
                try:
                    yt_benchmark = json.loads(ytch.last_benchmark_json)
                    yt_benchmark_label = ytch.title or ytch.handle
                    yt_benchmark_n = int(ytch.last_benchmark_sample_size or 0)
                except Exception:
                    yt_benchmark = None

        if payload.compare_mode == "specific_channel" and payload.competitor_channel.strip() and not yt_benchmark:
            ch = db.execute(
                select(Channel).where(func.lower(Channel.name) == payload.competitor_channel.strip().lower())
            ).scalar_one_or_none()
            if ch:
                coll_ids = [
                    c.id
                    for c in db.execute(select(Collection).where(Collection.channel_id == ch.id)).scalars().all()
                ]
                if coll_ids:
                    jobs = list(
                        db.execute(
                            select(Job).where(
                                Job.collection_id.in_(coll_ids),
                                Job.status == JobStatus.completed,
                            )
                        )
                        .scalars()
                        .all()
                    )
                    for j in jobs:
                        if j.result_path and Path(j.result_path).exists():
                            try:
                                bench_rows.append(json.loads(Path(j.result_path).read_text(encoding="utf-8")))
                            except Exception:
                                continue
                    bench_label = ch.name

        if payload.compare_mode == "niche_benchmark" and not bench_rows:
            jobs = list(
                db.execute(select(Job).where(Job.status == JobStatus.completed).order_by(Job.created_at.desc())).scalars().all()
            )
            for j in jobs:
                if j.id == payload.job_id:
                    continue
                if j.result_path and Path(j.result_path).exists():
                    try:
                        bench_rows.append(json.loads(Path(j.result_path).read_text(encoding="utf-8")))
                    except Exception:
                        continue
            # "top creators" approximation from internal data: top 30% by overall score
            scored = []
            for r in bench_rows:
                s = float((r.get("summary", {}) or {}).get("overall_score") or 0.0)
                scored.append((s, r))
            scored.sort(key=lambda x: x[0], reverse=True)
            if scored:
                keep = max(1, int(len(scored) * 0.3))
                bench_rows = [x[1] for x in scored[:keep]]
                bench_label = f"Top internal creators ({payload.niche})"

        bench = yt_benchmark or (benchmark_from_results(bench_rows) if bench_rows else None)
        if yt_benchmark_label:
            bench_label = yt_benchmark_label
        report = build_comparison_report(
            result=result,
            compare_mode=payload.compare_mode,
            niche=payload.niche,
            competitor_channel=payload.competitor_channel,
            goal=payload.goal,
            platform=payload.platform,
            benchmark_override=bench,
            benchmark_label_override=(bench_label or None),
            benchmark_sample_size=(yt_benchmark_n if yt_benchmark else len(bench_rows)),
        )
        return ComparisonOut(report=report)

    @app.post("/api/youtube/channel/ingest", response_model=YouTubeIngestCreateOut)
    def youtube_ingest(payload: YouTubeIngestCreateIn, db: Session = Depends(get_db)) -> YouTubeIngestCreateOut:
        handle = normalize_channel_handle(payload.channel)
        if not handle:
            raise HTTPException(status_code=400, detail="channel is required (e.g. @handle)")
        if not settings.youtube_api_key.strip():
            raise HTTPException(status_code=400, detail="backend missing YOUTUBE_API_KEY")

        ingest = YouTubeIngest(
            id=str(uuid.uuid4()),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            channel_handle=handle,
            requested_video_count=max(1, min(int(payload.video_count or settings.youtube_max_videos), 25)),
            status=YouTubeIngestStatus.queued,
            message="Queued",
        )
        db.add(ingest)
        db.commit()

        enqueue_task("app.youtube_tasks.ingest_youtube_channel", ingest.id)
        return YouTubeIngestCreateOut(
            ingest_id=ingest.id,
            status=ingest.status.value,
            channel_handle=ingest.channel_handle,
            message=ingest.message,
        )

    def _finalize_youtube_benchmark_if_ready(db: Session, handle: str, ingest_id: str) -> tuple[bool, int]:
        vids = list(
            db.execute(
                select(YouTubeVideo).where(
                    YouTubeVideo.ingest_id == ingest_id,
                    YouTubeVideo.channel_handle == handle,
                )
            )
            .scalars()
            .all()
        )
        completed_job_ids = [v.job_id for v in vids if v.status == YouTubeVideoStatus.completed and v.job_id]
        results: list[dict] = []
        for jid in completed_job_ids:
            j = db.get(Job, jid)
            if not j or j.status != JobStatus.completed:
                continue
            if j.result_path and Path(j.result_path).exists():
                try:
                    results.append(json.loads(Path(j.result_path).read_text(encoding="utf-8")))
                except Exception:
                    continue
        bench = benchmark_from_results(results) if results else None
        if not bench:
            return (False, 0)
        ytch = (
            db.execute(select(YouTubeChannel).where(func.lower(YouTubeChannel.handle) == handle.lower()))
            .scalar_one_or_none()
        )
        if not ytch:
            return (False, 0)
        ytch.last_benchmark_json = json.dumps(bench)
        ytch.last_benchmark_sample_size = len(results)
        ytch.last_benchmark_updated_at = datetime.utcnow()
        db.commit()
        return (True, len(results))

    @app.get("/api/youtube/ingest/{ingest_id}", response_model=YouTubeIngestStatusOut)
    def youtube_ingest_status(ingest_id: str, db: Session = Depends(get_db)) -> YouTubeIngestStatusOut:
        ingest = db.get(YouTubeIngest, ingest_id)
        if not ingest:
            raise HTTPException(status_code=404, detail="ingest not found")
        vids = list(db.execute(select(YouTubeVideo).where(YouTubeVideo.ingest_id == ingest.id)).scalars().all())
        total = len(vids)
        completed = sum(1 for v in vids if v.status == YouTubeVideoStatus.completed)
        failed = sum(1 for v in vids if v.status == YouTubeVideoStatus.failed)
        processing = sum(
            1 for v in vids if v.status in {YouTubeVideoStatus.analyzing, YouTubeVideoStatus.downloaded, YouTubeVideoStatus.queued}
        )

        benchmark_ready = False
        sample_size = 0
        if ingest.status in {YouTubeIngestStatus.processing, YouTubeIngestStatus.queued} and completed >= 3 and processing == 0:
            ok, n = _finalize_youtube_benchmark_if_ready(db, ingest.channel_handle, ingest.id)
            if ok:
                ingest.status = YouTubeIngestStatus.ready
                ingest.message = "Benchmark ready"
                ingest.updated_at = datetime.utcnow()
                db.commit()
                benchmark_ready = True
                sample_size = n

        if not benchmark_ready:
            ytch = (
                db.execute(select(YouTubeChannel).where(func.lower(YouTubeChannel.handle) == ingest.channel_handle.lower()))
                .scalar_one_or_none()
            )
            if ytch and (ytch.last_benchmark_json or "").strip() and ytch.last_benchmark_json.strip() != "{}":
                benchmark_ready = True
                sample_size = int(ytch.last_benchmark_sample_size or 0)

        return YouTubeIngestStatusOut(
            ingest_id=ingest.id,
            status=ingest.status.value,
            channel_handle=ingest.channel_handle,
            requested_video_count=int(ingest.requested_video_count or 0),
            message=ingest.message,
            total_videos=total,
            completed_videos=completed,
            failed_videos=failed,
            processing_videos=processing,
            benchmark_ready=benchmark_ready,
            benchmark_sample_size=sample_size,
        )

    return app


app = create_app()

