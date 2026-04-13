from __future__ import annotations

import json
import logging
import statistics
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import ORJSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import delete, func, select, text

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
from app.migrations import ensure_agent_tables, ensure_job_progress_columns, ensure_job_source_column, ensure_youtube_tables
from app.comparison_engine import benchmark_from_results, build_comparison_report
from app.schemas import (
    ComparisonIn,
    ComparisonOut,
    ChannelCollectionOut,
    ChannelCollectionsOut,
    ChannelItemOut,
    ChannelListOut,
    ChannelRenameIn,
    ChannelRenameSuccessOut,
    ChannelIdNameOut,
    ChannelAISummaryOut,
    ChannelSummaryListOut,
    ChannelSummaryOut,
    CollectionSummaryOut,
    HealthOut,
    JobCreateFromStorageIn,
    JobCreateFromStorageOut,
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
    YouTubeChannelJobIn,
    SupabaseStorageJobIn,
    UploadUrlOut,
)
from app.settings import settings

logger = logging.getLogger(__name__)


def _supabase_configured() -> bool:
    sk = (settings.supabase_service_role_key or settings.supabase_service_key or "").strip()
    return bool((settings.supabase_url or "").strip() and sk)


from app.utils.files import ensure_dir, safe_filename
from app.worker_queue import enqueue_job, enqueue_task
from app.supabase_repo import (
    upsert_analysis_row,
    upload_file_to_storage,
    put_result_json,
    list_analyses,
    list_analyses_by_channel,
    aggregate_analyses_by_channel_name,
    get_analysis,
    get_result,
    create_comparison_report,
    ensure_bucket_exists,
    create_signed_upload_url,
    create_signed_download_url,
    rename_channel_name_in_analyses,
    delete_analyses_by_channel_name,
)
from app.services.file_service import build_local_upload_path
from app.youtube_service import normalize_channel_handle
from app.channel_summary_ai import build_channel_summary_payload, generate_channel_summary_text


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
    ensure_job_source_column(engine)
    ensure_agent_tables(engine)
    ensure_youtube_tables(engine)
    ensure_dir(settings.uploads_dir)
    ensure_dir(settings.artifacts_dir)
    ensure_dir(settings.results_dir)
    ensure_dir(settings.clips_dir)

    app = FastAPI(default_response_class=ORJSONResponse, title=settings.app_name)

    # CORS must match the browser origin (e.g. videoanalysis vs vedioanalysis.netlify.app). Use settings + regex
    # so all Netlify preview/production HTTPS hosts work; do not hardcode a single typo'd hostname here.
    _cors_origins = [o.strip() for o in (settings.cors_origins or "").split(",") if o.strip()]
    if not _cors_origins:
        _cors_origins = ["http://localhost:3000", "http://localhost:3001"]
    _cors_regex = (settings.cors_origin_regex or "").strip() or None
    if settings.cors_allow_all:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["*"],
            expose_headers=["*"],
            max_age=3600,
        )
    else:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=_cors_origins,
            allow_origin_regex=_cors_regex,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["*"],
            expose_headers=["*"],
            max_age=3600,
        )

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

    @app.options("/{rest_of_path:path}")
    async def preflight_handler(rest_of_path: str):
        return {"status": "ok"}

    @app.get("/health", response_model=HealthOut)
    def health() -> HealthOut:
        return HealthOut(
            status="ok",
            worker_mode="rq" if settings.use_rq_queue else "inline",
            use_rq_queue=bool(settings.use_rq_queue),
        )

    # --- Direct-to-Supabase uploads (browser never sends video bytes to Railway) ---
    @app.get("/api/upload-url", response_model=UploadUrlOut)
    def api_get_presigned_upload_url(filename: str = Query(..., min_length=1)) -> UploadUrlOut:
        if not _supabase_configured():
            raise HTTPException(status_code=503, detail="Supabase is not configured on the server")
        original = safe_filename(filename)
        storage_path = f"videos/{uuid.uuid4()}/{original}"
        bucket = settings.supabase_bucket.strip() or "videos"
        try:
            out = create_signed_upload_url(bucket=bucket, path=storage_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        su = str(out.get("signed_url") or out.get("signedURL") or "").strip()
        if not su:
            raise HTTPException(status_code=500, detail="failed to create signed upload url")
        return UploadUrlOut(
            upload_url=su,
            storage_path=str(out.get("path") or storage_path).lstrip("/"),
            token=str(out.get("token") or ""),
        )

    @app.post("/api/jobs", response_model=JobCreateFromStorageOut)
    def create_job_after_storage_upload(payload: JobCreateFromStorageIn, db: Session = Depends(get_db)) -> JobCreateFromStorageOut:
        storage_path = (payload.storage_path or "").strip().lstrip("/")
        if not storage_path:
            raise HTTPException(status_code=400, detail="storage_path is required")
        original = safe_filename(payload.filename or "upload.mp4")
        job_id = str(uuid.uuid4())
        ext = Path(original).suffix or ".mp4"
        dest = Path(settings.uploads_dir) / f"{job_id}{ext}"

        cid = (payload.channel_id or "").strip()
        cn = (payload.channel_name or "").strip()
        if cid:
            ch = db.get(Channel, cid)
            if not ch:
                raise HTTPException(status_code=404, detail="channel not found")
            channel_name_for_sb = ch.name
        else:
            suggested, _ = _suggest_channel_name([original])
            ch = _get_or_create_channel(db, cn or suggested)
            channel_name_for_sb = ch.name

        collection_id = str(uuid.uuid4())
        coll = Collection(
            id=collection_id,
            created_at=datetime.utcnow(),
            channel_id=ch.id,
            title=f"{ch.name} upload",
        )
        db.add(coll)
        db.commit()

        now = datetime.utcnow()
        job = Job(
            id=job_id,
            created_at=now,
            updated_at=now,
            status=JobStatus.queued,
            original_filename=original,
            video_path=str(dest),
            job_source="supabase_storage",
            collection_id=collection_id,
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
                channel_name=channel_name_for_sb,
            )
        except Exception:
            pass
        enqueue_job(job_id)
        return JobCreateFromStorageOut(job_id=job_id, status="queued")

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

    # Removed: POST /api/jobs/upload, POST /upload, POST /api/upload (multipart + JSON register),
    # POST /api/jobs/upload/batch — they accepted raw video bytes on the API host.
    # Replacement: GET /api/upload-url → PUT file to signed URL (Supabase) → POST /api/jobs.
    # Legacy JSON register still available via POST /api/jobs/from-supabase after client upload.

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
        enqueue_task("app.youtube_url_tasks.download_then_enqueue", job_id, url, "")
        return UploadResponse(job_id=job_id, status=job.status.value, message="youtube url queued")

    @app.post("/api/jobs/youtube", response_model=UploadResponse)
    def create_youtube_job_with_channel(payload: YouTubeChannelJobIn, db: Session = Depends(get_db)) -> UploadResponse:
        """
        YouTube video URL tied to an existing SQLite channel (collection + job).
        Download runs in background (same pipeline as /api/jobs/from-youtube).
        """
        url = (payload.youtube_url or "").strip()
        cid = (payload.channel_id or "").strip()
        if not url:
            raise HTTPException(status_code=400, detail="youtube_url is required")
        if not cid:
            raise HTTPException(status_code=400, detail="channel_id is required")
        low = url.lower()
        if ("youtube.com/@" in low) or low.rstrip("/").endswith("/@") or low.startswith("@") or ("/channel/" in low) or ("/c/" in low):
            raise HTTPException(
                status_code=400,
                detail="This looks like a channel link/handle. Paste a single video URL.",
            )
        if ("watch?v=" not in low) and ("youtu.be/" not in low) and ("/shorts/" not in low):
            raise HTTPException(status_code=400, detail="Please paste a YouTube video URL (watch?v=..., youtu.be/..., or /shorts/...)")

        ch = db.get(Channel, cid)
        if not ch:
            raise HTTPException(status_code=404, detail="channel not found")

        job_id = str(uuid.uuid4())
        dest_dir = Path(settings.uploads_dir) / "youtube-urls"
        ensure_dir(dest_dir)
        dest = dest_dir / f"{job_id}.mp4"

        collection_id = str(uuid.uuid4())
        coll = Collection(
            id=collection_id,
            created_at=datetime.utcnow(),
            channel_id=ch.id,
            title=f"{ch.name} YouTube",
        )
        db.add(coll)
        db.commit()

        now = datetime.utcnow()
        job = Job(
            id=job_id,
            created_at=now,
            updated_at=now,
            status=JobStatus.queued,
            original_filename=f"youtube_url:{url[:220]}",
            video_path=str(dest),
            collection_id=collection_id,
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
                channel_name=ch.name,
            )
        except Exception:
            pass

        enqueue_task("app.youtube_url_tasks.download_then_enqueue", job_id, url, ch.name)
        return UploadResponse(
            job_id=job_id,
            status=job.status.value,
            collection_id=collection_id,
            channel_id=ch.id,
            channel_name=ch.name,
            suggested_channel_name="",
            suggestion_confidence="low",
            message="youtube url queued",
        )

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

    @app.get("/api/analyses")
    def api_list_analyses(limit: int = 200, include_result: bool = False) -> dict:
        """
        List analyses. Default omits `result_json` per row (huge) — use include_result=true only if needed.
        """
        rows = list_analyses(limit=limit, include_result_json=include_result)
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
        if result_json is None and row and row.get("result_json") is not None:
            result_json = row["result_json"]
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
        try:
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
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Error in /api/compare: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

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

    @app.get("/api/channels/summary", response_model=ChannelSummaryListOut)
    def channels_summary(db: Session = Depends(get_db)) -> ChannelSummaryListOut:
        """Channel deck: SQLite Channel list + aggregated stats from Supabase analyses (by channel_name)."""
        agg = aggregate_analyses_by_channel_name()
        channels = list(db.execute(select(Channel).order_by(Channel.created_at.desc())).scalars().all())
        out: list[ChannelSummaryOut] = []
        seen_keys: set[str] = set()
        for ch in channels:
            key = ch.name.strip().lower()
            seen_keys.add(key)
            a = agg.get(key) or {}
            out.append(
                ChannelSummaryOut(
                    id=ch.id,
                    name=ch.name,
                    totalVideos=int(a.get("totalVideos") or 0),
                    completedCount=int(a.get("completedCount") or 0),
                    processingCount=int(a.get("processingCount") or 0),
                    avgConfidence=float(round(float(a.get("avgConfidence") or 0.0), 1)),
                    avgEnergy=float(round(float(a.get("avgEnergy") or 0.0), 1)),
                    avgEyeContact=float(round(float(a.get("avgEyeContact") or 0.0), 3)),
                    lastAnalyzedAt=str(a.get("lastAnalyzedAt") or ""),
                    thumbnailUrl=a.get("thumbnailUrl"),
                    recentAvgConfidence=a.get("recentAvgConfidence"),
                    previousAvgConfidence=a.get("previousAvgConfidence"),
                )
            )

        # Also surface "Supabase-only" channel names that exist in analyses but not in SQLite Channels yet.
        # These are read-only in the UI (no rename/delete) but allow navigation to /channel/{name}.
        for key, a in (agg or {}).items():
            k = str(key or "").strip().lower()
            if not k or k in seen_keys:
                continue
            name = str(a.get("display_name") or key or "").strip() or str(key)
            out.append(
                ChannelSummaryOut(
                    id=f"supabase:{k}",
                    name=name,
                    totalVideos=int(a.get("totalVideos") or 0),
                    completedCount=int(a.get("completedCount") or 0),
                    processingCount=int(a.get("processingCount") or 0),
                    avgConfidence=float(round(float(a.get("avgConfidence") or 0.0), 1)),
                    avgEnergy=float(round(float(a.get("avgEnergy") or 0.0), 1)),
                    avgEyeContact=float(round(float(a.get("avgEyeContact") or 0.0), 3)),
                    lastAnalyzedAt=str(a.get("lastAnalyzedAt") or ""),
                    thumbnailUrl=a.get("thumbnailUrl"),
                    recentAvgConfidence=a.get("recentAvgConfidence"),
                    previousAvgConfidence=a.get("previousAvgConfidence"),
                )
            )
        return ChannelSummaryListOut(channels=out)

    @app.post("/api/channels/{channel_name}/summary", response_model=ChannelAISummaryOut)
    def channel_ai_summary_post(channel_name: str) -> ChannelAISummaryOut:
        """OpenAI-generated channel performance paragraph (server-side API key only)."""
        name = (channel_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="channel name is required")
        try:
            payload = build_channel_summary_payload(name)
            text = generate_channel_summary_text(payload)
            return ChannelAISummaryOut(summary=text)
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
        except Exception as e:
            logger.error(f"OpenAI error: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.get("/api/channels/{channel_name}/analyses")
    def channel_analyses_list(channel_name: str, include_result: bool = True) -> dict:
        """
        All analyses for a channel (case-insensitive channel_name), sorted by created_at ascending.
        Path segment is URL-decoded by FastAPI.
        """
        name = (channel_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="channel name is required")
        rows = list_analyses_by_channel(name, include_result_json=include_result)
        return {"analyses": rows}

    @app.get("/api/channels/{channel_name}/report")
    def channel_report(channel_name: str) -> dict:
        """
        Aggregated channel report computed server-side from Supabase analyses rows for this channel_name.
        Does NOT delete or modify Supabase rows.
        """
        name = (channel_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="channel name is required")
        rows = list_analyses_by_channel(name, include_result_json=True)
        if not rows:
            return {
                "channel_name": name,
                "total_videos": 0,
                "completed_videos": 0,
                "total_duration_sec": 0,
                "avg_confidence": 0.0,
                "avg_energy": 0.0,
                "avg_wpm": 0.0,
                "avg_eye_contact": 0.0,
                "confidence_trend": None,
                "recent_avg_confidence": None,
                "previous_avg_confidence": None,
                "top_coach_patterns": [],
                "best_videos": [],
                "worst_videos": [],
                "confidence_over_time": [],
                "benchmark": {
                    "confidence": {"n": 0, "missing": 0, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None, "hist": {"labels": [], "counts": []}},
                    "energy": {"n": 0, "missing": 0, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None, "hist": {"labels": [], "counts": []}},
                    "wpm": {"n": 0, "missing": 0, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None, "hist": {"labels": [], "counts": []}},
                    "eye_contact_pct": {"n": 0, "missing": 0, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None, "hist": {"labels": [], "counts": []}},
                    "fillers_per_min": {"n": 0, "missing": 0, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None, "hist": {"labels": [], "counts": []}},
                    "gestures_per_min": {"n": 0, "missing": 0, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None, "hist": {"labels": [], "counts": []}},
                    "tonal": {"n": 0, "missing": 0, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None, "hist": {"labels": [], "counts": []}},
                    "expression_changes_per_min": {"n": 0, "missing": 0, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None, "hist": {"labels": [], "counts": []}},
                },
                "individual_videos": [],
            }

        def _f(v) -> float | None:
            try:
                if v is None:
                    return None
                n = float(v)
                return n if n == n else None
            except Exception:
                return None

        def _round1(v: float | None) -> float | None:
            return round(float(v), 1) if v is not None else None

        def _percentile(sorted_vals: list[float], p: float) -> float | None:
            """
            Linear interpolation percentile on a pre-sorted list.
            p is 0..100.
            """
            if not sorted_vals:
                return None
            if p <= 0:
                return float(sorted_vals[0])
            if p >= 100:
                return float(sorted_vals[-1])
            k = (len(sorted_vals) - 1) * (p / 100.0)
            f = int(k)
            c = min(f + 1, len(sorted_vals) - 1)
            if f == c:
                return float(sorted_vals[f])
            d0 = sorted_vals[f] * (c - k)
            d1 = sorted_vals[c] * (k - f)
            return float(d0 + d1)

        def _clamp(v: float, lo: float, hi: float) -> float:
            return lo if v < lo else hi if v > hi else v

        def _hist_fixed(values: list[float], edges: list[float], labels: list[str]) -> dict[str, list]:
            """
            Histogram with fixed bin edges.
            edges: monotonic list of boundaries, length = len(labels)+1.
            """
            counts = [0 for _ in labels]
            for x in values:
                for i in range(len(labels)):
                    lo = edges[i]
                    hi = edges[i + 1]
                    if i == len(labels) - 1:
                        if x >= lo and x <= hi:
                            counts[i] += 1
                            break
                    else:
                        if x >= lo and x < hi:
                            counts[i] += 1
                            break
            return {"labels": labels, "counts": counts}

        def _hist_by_predicates(values: list[float], buckets: list[tuple[str, callable]]) -> dict[str, list]:
            counts = [0 for _ in buckets]
            for x in values:
                for i, (_, pred) in enumerate(buckets):
                    if pred(x):
                        counts[i] += 1
                        break
            return {"labels": [b[0] for b in buckets], "counts": counts}

        def _bench(values: list[float | None], *, total_expected: int, metric_key: str) -> dict:
            vals = sorted([float(v) for v in values if v is not None])
            n = int(len(vals))
            missing = int(max(0, int(total_expected) - n))
            out = {
                "n": n,
                "missing": missing,
                "p10": _round1(_percentile(vals, 10)),
                "p25": _round1(_percentile(vals, 25)),
                "p50": _round1(_percentile(vals, 50)),
                "p75": _round1(_percentile(vals, 75)),
                "p90": _round1(_percentile(vals, 90)),
                "hist": {"labels": [], "counts": []},
            }

            if not vals:
                return out

            # Buckets per metric (matches UI guidance and existing label thresholds).
            if metric_key in ("confidence", "energy"):
                clamped = [_clamp(v, 0.0, 100.0) for v in vals]
                out["hist"] = _hist_fixed(
                    clamped,
                    [0.0, 50.0, 70.0, 85.0, 100.0],
                    ["0–49", "50–69", "70–84", "85–100"],
                )
            elif metric_key == "wpm":
                out["hist"] = _hist_by_predicates(
                    vals,
                    [
                        ("<95", lambda x: x < 95),
                        ("95–120", lambda x: 95 <= x < 120),
                        ("120–160", lambda x: 120 <= x <= 160),
                        (">160", lambda x: x > 160),
                    ],
                )
            elif metric_key == "eye_contact_pct":
                clamped = [_clamp(v, 0.0, 100.0) for v in vals]
                out["hist"] = _hist_fixed(
                    clamped,
                    [0.0, 30.0, 50.0, 70.0, 100.0],
                    ["0–29%", "30–49%", "50–69%", "70–100%"],
                )
            elif metric_key == "fillers_per_min":
                out["hist"] = _hist_by_predicates(
                    vals,
                    [
                        ("0–2.0", lambda x: x <= 2.0),
                        ("2.0–5.0", lambda x: 2.0 < x <= 5.0),
                        ("5.0–8.0", lambda x: 5.0 < x <= 8.0),
                        (">8.0", lambda x: x > 8.0),
                    ],
                )
            elif metric_key == "gestures_per_min":
                out["hist"] = _hist_by_predicates(
                    vals,
                    [
                        ("0–3.9", lambda x: x < 4.0),
                        ("4.0–10.0", lambda x: 4.0 <= x < 10.0),
                        ("10.0–20.0", lambda x: 10.0 <= x <= 20.0),
                        (">20.0", lambda x: x > 20.0),
                    ],
                )
            elif metric_key == "expression_changes_per_min":
                out["hist"] = _hist_by_predicates(
                    vals,
                    [
                        ("0–19.9", lambda x: x < 20.0),
                        ("20.0–40.0", lambda x: 20.0 <= x < 40.0),
                        ("40.0–60.0", lambda x: 40.0 <= x <= 60.0),
                        (">60.0", lambda x: x > 60.0),
                    ],
                )
            elif metric_key == "tonal":
                # Tonal score scale differs by pipeline; use quartiles (data-driven) to avoid hallucinated thresholds.
                p25 = _percentile(vals, 25)
                p50 = _percentile(vals, 50)
                p75 = _percentile(vals, 75)
                if p25 is None or p50 is None or p75 is None:
                    out["hist"] = {"labels": [], "counts": []}
                else:
                    out["hist"] = _hist_by_predicates(
                        vals,
                        [
                            ("≤p25", lambda x, p25=p25: x <= p25),
                            ("p25–p50", lambda x, p25=p25, p50=p50: p25 < x <= p50),
                            ("p50–p75", lambda x, p50=p50, p75=p75: p50 < x <= p75),
                            (">p75", lambda x, p75=p75: x > p75),
                        ],
                    )

            return out

        total_videos = len(rows)
        completed_rows = [r for r in rows if str(r.get("status") or "") == "completed"]
        completed_videos = len(completed_rows)

        # Total runtime across all completed videos (seconds).
        dur_vals = [_f(r.get("duration_sec")) for r in completed_rows]
        total_duration_sec = int(sum([float(v) for v in dur_vals if v is not None and float(v) > 0.0]) or 0)

        confs = [_f(r.get("confidence_score")) for r in completed_rows]
        engs = [_f(r.get("energy_score")) for r in completed_rows]
        wpms = [_f(r.get("wpm")) for r in completed_rows]
        eyes = [_f(r.get("eye_contact_ratio")) for r in completed_rows]
        conf_vals = [v for v in confs if v is not None]
        eng_vals = [v for v in engs if v is not None]
        wpm_vals = [v for v in wpms if v is not None]
        eye_vals = [v for v in eyes if v is not None]

        avg_conf = _round1(float(statistics.mean(conf_vals))) if conf_vals else 0.0
        avg_energy = _round1(float(statistics.mean(eng_vals))) if eng_vals else 0.0
        avg_wpm = _round1(float(statistics.mean(wpm_vals))) if wpm_vals else 0.0
        # Eye contact reported as percentage (0..100)
        avg_eye_raw = float(statistics.mean(eye_vals)) if eye_vals else 0.0
        avg_eye_pct = avg_eye_raw * 100.0 if avg_eye_raw <= 1.0 else avg_eye_raw
        avg_eye_contact = _round1(avg_eye_pct) if completed_videos else 0.0

        # Trend: latest 5 vs previous 5 by created_at desc (requires 10 scored videos)
        scored_for_trend = [
            r for r in completed_rows if _f(r.get("confidence_score")) is not None and str(r.get("created_at") or "").strip()
        ]
        scored_for_trend.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        latest_5 = scored_for_trend[:5]
        prev_5 = scored_for_trend[5:10]
        recent_avg_confidence = None
        previous_avg_confidence = None
        confidence_trend = None
        if latest_5:
            recent_avg_confidence = _round1(float(statistics.mean([float(r["confidence_score"]) for r in latest_5])))
        if len(prev_5) >= 5:
            previous_avg_confidence = _round1(float(statistics.mean([float(r["confidence_score"]) for r in prev_5])))
        if recent_avg_confidence is not None and previous_avg_confidence is not None:
            d = float(recent_avg_confidence) - float(previous_avg_confidence)
            if d > 2:
                confidence_trend = "improving"
            elif d < -2:
                confidence_trend = "declining"
            else:
                confidence_trend = "stable"

        # Coach patterns: result_json.coach_comments[].comment grouped by text
        counts: dict[str, int] = {}
        for r in completed_rows:
            rj = r.get("result_json")
            if not isinstance(rj, dict):
                continue
            cc = rj.get("coach_comments")
            if not isinstance(cc, list):
                continue
            for item in cc:
                if not isinstance(item, dict):
                    continue
                t = str(item.get("comment") or "").strip()
                if not t:
                    continue
                counts[t] = counts.get(t, 0) + 1
        top_coach_patterns = [
            {"comment": k, "count": int(v)}
            for k, v in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
        ]

        # Best/Worst by confidence
        scored = []
        for r in completed_rows:
            c = _f(r.get("confidence_score"))
            if c is None:
                continue
            scored.append((float(c), r))
        scored.sort(key=lambda x: x[0], reverse=True)
        best_videos = []
        worst_videos = []
        for c, r in scored[:3]:
            best_videos.append(
                {
                    "filename": str(r.get("original_filename") or r.get("title") or r.get("job_id") or r.get("id") or ""),
                    "confidence": _round1(c) if c is not None else None,
                    "analysis_id": str(r.get("job_id") or r.get("id") or ""),
                }
            )
        for c, r in list(reversed(scored))[:3]:
            worst_videos.append(
                {
                    "filename": str(r.get("original_filename") or r.get("title") or r.get("job_id") or r.get("id") or ""),
                    "confidence": _round1(c) if c is not None else None,
                    "analysis_id": str(r.get("job_id") or r.get("id") or ""),
                }
            )

        # Confidence over time: daily average (YYYY-MM-DD)
        by_day: dict[str, list[float]] = {}
        for r in completed_rows:
            c = _f(r.get("confidence_score"))
            if c is None:
                continue
            ca = str(r.get("created_at") or "")
            if not ca:
                continue
            day = ca[:10]
            by_day.setdefault(day, []).append(float(c))
        confidence_over_time = [
            {"date": day, "value": _round1(float(statistics.mean(vals)))}
            for day, vals in sorted(by_day.items(), key=lambda kv: kv[0])
            if vals
        ]

        # Individual videos (newest first)
        ind = completed_rows[:]
        ind.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)

        def _metric_from_rj(rj: dict, path: list[str]) -> float | None:
            cur = rj
            for k in path:
                if not isinstance(cur, dict) or k not in cur:
                    return None
                cur = cur.get(k)
            return _f(cur)

        individual_videos = []
        for r in ind:
            analysis_id = str(r.get("job_id") or r.get("id") or "")
            filename = str(r.get("original_filename") or r.get("title") or analysis_id)
            created_at = str(r.get("created_at") or "")
            conf = _round1(_f(r.get("confidence_score")))
            energy = _round1(_f(r.get("energy_score")))
            eye_ratio = _f(r.get("eye_contact_ratio"))
            eye_pct = None
            if eye_ratio is not None:
                eye_pct = _round1(eye_ratio * 100.0 if eye_ratio <= 1.0 else eye_ratio)
            wpm = _round1(_f(r.get("wpm")))

            fillers = _round1(_f(r.get("fillers_per_min")))
            gestures = _round1(_f(r.get("gestures_per_min")))
            tonal = None
            expr = None
            rj = r.get("result_json") if isinstance(r.get("result_json"), dict) else None
            if rj:
                tonal = _round1(
                    _metric_from_rj(rj, ["cards", "tonal_variation", "score"])
                    or _metric_from_rj(rj, ["cards", "tonal_variation", "pitch_hz", "std"])
                )
                expr_count = _metric_from_rj(rj, ["cards", "expressions", "change_count"])
                dur = _f(r.get("duration_sec")) or _metric_from_rj(rj, ["summary", "duration_sec"]) or 0.0
                if expr_count is not None and dur and dur > 0:
                    expr = _round1(float(expr_count) / (float(dur) / 60.0))

            individual_videos.append(
                {
                    "analysis_id": analysis_id,
                    "filename": filename,
                    "confidence_score": conf,
                    "energy_score": energy,
                    "eye_contact_ratio": eye_pct,
                    "created_at": created_at,
                    "metrics": {
                        "speech_rate_wpm": wpm,
                        "filler_rate": fillers,
                        "gesture_rate": gestures,
                        "tonal_variation": tonal,
                        "expression_change": expr,
                    },
                }
            )

        # All-time channel benchmark: robust percentiles + per-metric sample sizes.
        expected = int(completed_videos)
        bench = {
            "confidence": _bench([_f(r.get("confidence_score")) for r in completed_rows], total_expected=expected, metric_key="confidence"),
            "energy": _bench([_f(r.get("energy_score")) for r in completed_rows], total_expected=expected, metric_key="energy"),
            "wpm": _bench([_f(r.get("wpm")) for r in completed_rows], total_expected=expected, metric_key="wpm"),
            "eye_contact_pct": _bench(
                [
                    (x * 100.0 if x is not None and x <= 1.0 else x)
                    for x in [_f(r.get("eye_contact_ratio")) for r in completed_rows]
                ],
                total_expected=expected,
                metric_key="eye_contact_pct",
            ),
            "fillers_per_min": _bench([_f(r.get("fillers_per_min")) for r in completed_rows], total_expected=expected, metric_key="fillers_per_min"),
            "gestures_per_min": _bench([_f(r.get("gestures_per_min")) for r in completed_rows], total_expected=expected, metric_key="gestures_per_min"),
            "tonal": _bench([_f(v.get("metrics", {}).get("tonal_variation")) for v in individual_videos], total_expected=expected, metric_key="tonal"),
            "expression_changes_per_min": _bench(
                [_f(v.get("metrics", {}).get("expression_change")) for v in individual_videos],
                total_expected=expected,
                metric_key="expression_changes_per_min",
            ),
        }

        return {
            "channel_name": name,
            "total_videos": int(total_videos),
            "completed_videos": int(completed_videos),
            "total_duration_sec": int(total_duration_sec),
            "avg_confidence": avg_conf,
            "avg_energy": avg_energy,
            "avg_wpm": avg_wpm,
            "avg_eye_contact": avg_eye_contact,
            "confidence_trend": confidence_trend,
            "recent_avg_confidence": recent_avg_confidence,
            "previous_avg_confidence": previous_avg_confidence,
            "top_coach_patterns": top_coach_patterns,
            "best_videos": best_videos,
            "worst_videos": worst_videos,
            "confidence_over_time": confidence_over_time,
            "benchmark": bench,
            "individual_videos": individual_videos,
        }

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

    @app.patch("/api/channels/{channel_id}", response_model=ChannelRenameSuccessOut)
    def rename_channel(channel_id: str, payload: ChannelRenameIn, db: Session = Depends(get_db)) -> ChannelRenameSuccessOut:
        if str(channel_id or "").startswith("supabase:"):
            raise HTTPException(status_code=400, detail="read-only channel (exists only in Supabase analyses)")
        ch = db.get(Channel, channel_id)
        if not ch:
            raise HTTPException(status_code=404, detail="channel not found")
        old_name = (ch.name or "").strip()
        new_name = (payload.name or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="channel name is required")
        exists = db.execute(
            select(Channel).where(func.lower(Channel.name) == new_name.lower(), Channel.id != channel_id)
        ).scalar_one_or_none()
        if exists:
            raise HTTPException(status_code=400, detail="channel name already exists")
        ch.name = new_name
        db.commit()
        db.refresh(ch)
        # Keep Supabase analyses grouped under the renamed display name to avoid "disappearing" channels.
        try:
            if old_name and new_name and old_name.lower() != new_name.lower():
                rename_channel_name_in_analyses(old_name=old_name, new_name=new_name)
        except Exception:
            # Best-effort; SQLite rename is still the source of truth for the channel list.
            pass
        return ChannelRenameSuccessOut(success=True, channel=ChannelIdNameOut(id=ch.id, name=ch.name))

    @app.delete("/api/channels/{channel_id}")
    def delete_channel(channel_id: str, db: Session = Depends(get_db)) -> dict:
        if str(channel_id or "").startswith("supabase:"):
            raise HTTPException(status_code=400, detail="read-only channel (exists only in Supabase analyses)")
        ch = db.get(Channel, channel_id)
        if not ch:
            raise HTTPException(status_code=404, detail="channel not found")
        # If this raised 409 before: detail was
        # "cannot delete channel while dependent database rows still reference it" (IntegrityError on FK).
        # Cascade deletes below (SQLite/Postgres). Job has no channel_id — link is Channel → Collection → Job.
        try:
            collection_ids = list(
                db.execute(select(Collection.id).where(Collection.channel_id == channel_id)).scalars().all()
            )
            if collection_ids:
                job_ids = list(
                    db.execute(select(Job.id).where(Job.collection_id.in_(collection_ids))).scalars().all()
                )
                if job_ids:
                    db.execute(delete(YouTubeVideo).where(YouTubeVideo.job_id.in_(job_ids)))
                db.execute(delete(Job).where(Job.collection_id.in_(collection_ids)))
                db.execute(delete(Collection).where(Collection.channel_id == channel_id))
            db.execute(delete(Channel).where(Channel.id == channel_id))
            db.commit()
        except Exception as e:
            db.rollback()
            logger.exception("Delete channel failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e)) from e
        # Supabase analyses rows are never deleted here (historical data preserved).
        return {"success": True, "id": channel_id}

    @app.delete("/api/channels/by-name/{channel_name}")
    def delete_channel_by_name(channel_name: str) -> dict:
        """
        Permanently delete Supabase analyses rows for a channel_name (case-insensitive).
        This is used for "Supabase-only" channels on the dashboard.
        """
        name = (channel_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="channel name is required")
        deleted = delete_analyses_by_channel_name(channel_name=name)
        return {"success": True, "channel_name": name, "deleted": int(deleted or 0)}

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
    def get_job_result_file(job_id: str, db: Session = Depends(get_db)) -> JobResultOut:
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

