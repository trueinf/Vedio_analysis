import enum
from datetime import datetime

from sqlalchemy import Float, String, DateTime, Enum, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class JobStatus(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.queued, nullable=False)

    original_filename: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    video_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    collection_id: Mapped[str] = mapped_column(String(36), default="", nullable=False)

    duration_sec: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    stage: Mapped[str] = mapped_column(String(64), default="queued", nullable=False)
    progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)  # 0..1

    error_message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    result_path: Mapped[str] = mapped_column(String(1024), default="", nullable=False)


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    name: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    channel_id: Mapped[str] = mapped_column(String(36), ForeignKey("channels.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(256), default="", nullable=False)


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    video_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Metrics(Base):
    __tablename__ = "metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(String(36), ForeignKey("videos.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    metrics_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(String(36), ForeignKey("videos.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    feedback_text: Mapped[str] = mapped_column(Text, default="", nullable=False)


class YouTubeIngestStatus(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class YouTubeChannel(Base):
    __tablename__ = "youtube_channels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    # normalized: "@handle" (preferred) or "UC..." id
    handle: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)
    channel_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    title: Mapped[str] = mapped_column(String(512), default="", nullable=False)

    last_ingest_id: Mapped[str] = mapped_column(String(36), default="", nullable=False)
    last_benchmark_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    last_benchmark_sample_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_benchmark_updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class YouTubeIngest(Base):
    __tablename__ = "youtube_ingests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    channel_handle: Mapped[str] = mapped_column(String(256), nullable=False)
    requested_video_count: Mapped[int] = mapped_column(Integer, default=10, nullable=False)

    status: Mapped[YouTubeIngestStatus] = mapped_column(
        Enum(YouTubeIngestStatus), default=YouTubeIngestStatus.queued, nullable=False
    )
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)


class YouTubeVideoStatus(str, enum.Enum):
    queued = "queued"
    downloaded = "downloaded"
    analyzing = "analyzing"
    completed = "completed"
    failed = "failed"


class YouTubeVideo(Base):
    __tablename__ = "youtube_videos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    ingest_id: Mapped[str] = mapped_column(String(36), ForeignKey("youtube_ingests.id"), nullable=False)
    channel_handle: Mapped[str] = mapped_column(String(256), nullable=False)

    youtube_video_id: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    url: Mapped[str] = mapped_column(String(1024), default="", nullable=False)

    video_path: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    job_id: Mapped[str] = mapped_column(String(36), default="", nullable=False)
    status: Mapped[YouTubeVideoStatus] = mapped_column(
        Enum(YouTubeVideoStatus), default=YouTubeVideoStatus.queued, nullable=False
    )
    error_message: Mapped[str] = mapped_column(Text, default="", nullable=False)

