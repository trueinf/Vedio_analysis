from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


JobStatus = Literal["queued", "processing", "completed", "failed"]


class JobOut(BaseModel):
    id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    original_filename: str
    duration_sec: int
    stage: str = "queued"
    progress: float = 0.0
    error_message: str = ""


class JobCreateResponse(BaseModel):
    job: JobOut


class JobHistoryItemOut(BaseModel):
    id: str
    created_at: datetime
    updated_at: datetime
    status: JobStatus
    stage: str = "queued"
    progress: float = 0.0
    original_filename: str = ""
    duration_sec: int = 0
    has_result: bool = False


class JobHistoryOut(BaseModel):
    jobs: list[JobHistoryItemOut]


class JobResultOut(BaseModel):
    job_id: str
    result: dict[str, Any]


class HealthOut(BaseModel):
    status: str = "ok"
    # Helps verify production config: inline = daemon thread in API; rq = separate worker required
    worker_mode: Literal["inline", "rq"] = "inline"
    use_rq_queue: bool = False


class UploadResponse(BaseModel):
    job_id: str
    status: JobStatus
    collection_id: str = ""
    channel_id: str = ""
    channel_name: str = ""
    suggested_channel_name: str = ""
    suggestion_confidence: str = "low"
    message: str = Field(default="uploaded")


class FastUploadResponse(BaseModel):
    """Immediate response after upload is queued — no processing in the request."""

    analysis_id: str
    status: Literal["queued"] = "queued"


class UploadRegisterIn(BaseModel):
    """Register a video already in Supabase Storage (or path the worker will fetch)."""

    storage_path: str = Field(default="", description="Object path within the videos bucket")
    original_filename: str = "upload.mp4"
    channel_name: str = ""


class UploadUrlOut(BaseModel):
    """Presigned upload target — browser uploads bytes here (not to Railway)."""

    upload_url: str
    storage_path: str
    token: str = ""


class JobCreateFromStorageIn(BaseModel):
    """Create a queued job after the file is already in Supabase Storage."""

    storage_path: str
    filename: str
    channel_id: Optional[str] = None
    channel_name: Optional[str] = None


class JobCreateFromStorageOut(BaseModel):
    job_id: str
    status: JobStatus


class YouTubeJobIn(BaseModel):
    url: str = Field(default="", description="YouTube video URL")
    channel_name: str = ""


class YouTubeChannelJobIn(BaseModel):
    youtube_url: str = ""
    channel_id: str = ""


class SupabaseStorageJobIn(BaseModel):
    storage_path: str = Field(default="", description="Supabase Storage object path (within bucket)")
    original_filename: str = Field(default="upload.mp4")
    channel_name: str = ""



class BatchUploadResponse(BaseModel):
    jobs: list[UploadResponse]
    collection_id: str = ""
    channel_id: str = ""
    channel_name: str = ""
    suggested_channel_name: str = ""
    suggestion_confidence: str = "low"
    message: str = Field(default="uploaded")


class CollectionSummaryOut(BaseModel):
    collection_id: str
    total_videos: int
    completed_videos: int
    failed_videos: int
    processing_videos: int
    summary: dict[str, Any]


class ChannelItemOut(BaseModel):
    id: str
    name: str
    collections: int = 0
    videos: int = 0
    latest_collection_id: str = ""


class ChannelListOut(BaseModel):
    channels: list[ChannelItemOut]


class ChannelSummaryOut(BaseModel):
    """Dashboard channel deck — stats from Supabase analyses merged with SQLite Channel rows."""

    id: str
    name: str
    totalVideos: int = 0
    completedCount: int = 0
    processingCount: int = 0
    avgConfidence: float = 0.0
    avgEnergy: float = 0.0
    avgEyeContact: float = 0.0
    lastAnalyzedAt: str = ""
    thumbnailUrl: str | None = None
    recentAvgConfidence: Optional[float] = None
    previousAvgConfidence: Optional[float] = None


class ChannelSummaryListOut(BaseModel):
    channels: list[ChannelSummaryOut]


class ChannelAISummaryOut(BaseModel):
    summary: str


class ChannelCollectionOut(BaseModel):
    collection_id: str
    title: str
    created_at: datetime
    total_videos: int
    completed_videos: int
    failed_videos: int


class ChannelCollectionsOut(BaseModel):
    channel_id: str
    channel_name: str
    collections: list[ChannelCollectionOut]


class ChannelRenameIn(BaseModel):
    name: str


class ChannelIdNameOut(BaseModel):
    id: str
    name: str


class ChannelRenameSuccessOut(BaseModel):
    success: bool = True
    channel: ChannelIdNameOut


class ComparisonIn(BaseModel):
    job_id: str
    source_type: Literal["upload", "youtube_url"] = "upload"
    video_url: str = ""
    compare_mode: Literal["niche_benchmark", "specific_channel"] = "niche_benchmark"
    niche: str = "education"
    competitor_channel: str = ""
    goal: Literal["retention", "clarity", "conversion", "confidence"] = "retention"
    platform: Literal["youtube_long", "youtube_shorts"] = "youtube_long"
    language: str = "en"
    format: Literal["talking_head", "tutorial", "vlog", "interview"] = "talking_head"
    audience_level: Literal["beginner", "intermediate", "advanced"] = "beginner"


class ComparisonOut(BaseModel):
    report: dict[str, Any]


class YouTubeIngestCreateIn(BaseModel):
    channel: str = Field(default="", description="Channel handle like @name or URL")
    video_count: int = 10


class YouTubeIngestCreateOut(BaseModel):
    ingest_id: str
    status: str
    channel_handle: str
    message: str = ""


class YouTubeIngestStatusOut(BaseModel):
    ingest_id: str
    status: str
    channel_handle: str
    requested_video_count: int
    message: str = ""
    total_videos: int = 0
    completed_videos: int = 0
    failed_videos: int = 0
    processing_videos: int = 0
    benchmark_ready: bool = False
    benchmark_sample_size: int = 0

