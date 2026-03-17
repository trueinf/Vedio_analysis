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
    message: str = Field(default="uploaded")

