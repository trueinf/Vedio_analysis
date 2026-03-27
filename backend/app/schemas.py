from datetime import datetime
from typing import Any, Literal

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


class JobResultOut(BaseModel):
    job_id: str
    result: dict[str, Any]


class HealthOut(BaseModel):
    status: str = "ok"


class UploadResponse(BaseModel):
    job_id: str
    status: JobStatus
    collection_id: str = ""
    channel_id: str = ""
    channel_name: str = ""
    suggested_channel_name: str = ""
    suggestion_confidence: str = "low"
    message: str = Field(default="uploaded")


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

