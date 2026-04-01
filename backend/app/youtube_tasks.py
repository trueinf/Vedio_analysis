from __future__ import annotations

import traceback
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Job, JobStatus, YouTubeChannel, YouTubeIngest, YouTubeIngestStatus, YouTubeVideo, YouTubeVideoStatus
from app.settings import settings
from app.utils.files import ensure_dir, safe_filename
from app.video_meta import probe_duration_sec
from app.worker_queue import enqueue_job
from app.youtube_service import list_recent_videos, resolve_channel_id, normalize_channel_handle
from app.supabase_repo import upload_file_to_storage, upsert_analysis_row


def _download_youtube_video(url: str, out_path: str) -> None:
    # Lazy import so backend can still start without yt-dlp in dev.
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
        "format": "best[ext=mp4][acodec!=none][vcodec!=none][height<=720]/best[ext=mp4][acodec!=none][vcodec!=none]/best",
        "ffmpeg_location": settings.ffmpeg_bin,
    }
    with YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])


def ingest_youtube_channel(ingest_id: str) -> None:
    db: Session = SessionLocal()
    try:
        ingest = db.get(YouTubeIngest, ingest_id)
        if not ingest:
            return

        ingest.status = YouTubeIngestStatus.processing
        ingest.message = "Resolving channel..."
        ingest.updated_at = datetime.utcnow()
        db.commit()

        handle = normalize_channel_handle(ingest.channel_handle)
        resolved = resolve_channel_id(handle)
        channel_id = resolved["channel_id"]
        title = resolved.get("title", "")

        ch = db.execute(select(YouTubeChannel).where(YouTubeChannel.handle == handle)).scalar_one_or_none()
        if not ch:
            ch = YouTubeChannel(
                id=str(uuid.uuid4()),
                created_at=datetime.utcnow(),
                handle=handle,
                channel_id=channel_id,
                title=title,
                last_ingest_id=ingest.id,
                last_benchmark_json="{}",
                last_benchmark_sample_size=0,
                last_benchmark_updated_at=datetime.utcnow(),
            )
            db.add(ch)
        else:
            ch.channel_id = channel_id
            if title:
                ch.title = title
            ch.last_ingest_id = ingest.id
        db.commit()

        ingest.message = "Fetching recent videos..."
        ingest.updated_at = datetime.utcnow()
        db.commit()

        videos = list_recent_videos(channel_id, limit=int(ingest.requested_video_count or settings.youtube_max_videos))
        if not videos:
            raise RuntimeError("No videos found for channel")

        ingest.message = f"Found {len(videos)} videos. Downloading & queuing analysis..."
        ingest.updated_at = datetime.utcnow()
        db.commit()

        base_dir = Path(settings.uploads_dir) / "youtube" / safe_filename(handle.lstrip("@") or handle)
        ensure_dir(base_dir)

        for v in videos:
            yt_id = str(v.get("video_id") or "")
            if not yt_id:
                continue
            url = str(v.get("url") or f"https://www.youtube.com/watch?v={yt_id}")
            title = str(v.get("title") or "")

            existing = db.execute(
                select(YouTubeVideo).where(
                    YouTubeVideo.ingest_id == ingest.id,
                    YouTubeVideo.youtube_video_id == yt_id,
                )
            ).scalar_one_or_none()
            if existing:
                continue

            ytv = YouTubeVideo(
                id=str(uuid.uuid4()),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                ingest_id=ingest.id,
                channel_handle=handle,
                youtube_video_id=yt_id,
                title=title,
                url=url,
                video_path="",
                job_id="",
                status=YouTubeVideoStatus.queued,
                error_message="",
            )
            db.add(ytv)
            db.commit()

            try:
                ytv.status = YouTubeVideoStatus.downloaded
                ytv.updated_at = datetime.utcnow()
                db.commit()

                out_path = str(base_dir / f"{yt_id}.mp4")
                _download_youtube_video(url, out_path)

                ytv.video_path = out_path
                ytv.status = YouTubeVideoStatus.analyzing
                ytv.updated_at = datetime.utcnow()
                db.commit()

                job_id = str(uuid.uuid4())
                duration = int(probe_duration_sec(out_path, ffprobe_bin=settings.ffprobe_bin) or 0)
                job = Job(
                    id=job_id,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                    status=JobStatus.queued,
                    original_filename=f"youtube:{handle}:{yt_id}",
                    video_path=out_path,
                    collection_id="",
                    duration_sec=duration,
                    stage="queued",
                    progress=0.0,
                    error_message="",
                    result_path="",
                )
                db.add(job)
                db.commit()

                # Best-effort persist to Supabase Storage + DB.
                storage_path = f"{job_id}/{yt_id}.mp4"
                try:
                    upload_file_to_storage(local_path=str(out_path), storage_path=storage_path, content_type="video/mp4")
                    upsert_analysis_row(
                        analysis_id=job_id,
                        source_type="youtube_url",
                        source_url=url,
                        title=title or f"youtube:{handle}:{yt_id}",
                        video_storage_path=storage_path,
                        duration_sec=int(duration or 0),
                        status="queued",
                        stage="queued",
                        progress=0.0,
                    )
                except Exception:
                    pass

                ytv.job_id = job_id
                ytv.updated_at = datetime.utcnow()
                db.commit()

                enqueue_job(job_id)
            except Exception as e:
                ytv.status = YouTubeVideoStatus.failed
                ytv.error_message = f"{e}\n{traceback.format_exc()}"
                ytv.updated_at = datetime.utcnow()
                db.commit()

        ingest.message = "Queued analysis jobs. Benchmark will be ready when jobs complete."
        ingest.updated_at = datetime.utcnow()
        db.commit()
        # Do not mark ready here; status endpoint will finalize benchmark when enough results exist.
    except Exception as e:
        ingest = db.get(YouTubeIngest, ingest_id)
        if ingest:
            ingest.status = YouTubeIngestStatus.failed
            ingest.message = f"{e}\n{traceback.format_exc()}"
            ingest.updated_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()

