"""Integration tests for DELETE /api/channels/{channel_id} cascade."""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import select
from starlette.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (
    Channel,
    Collection,
    Job,
    JobStatus,
    YouTubeIngest,
    YouTubeIngestStatus,
    YouTubeVideo,
    YouTubeVideoStatus,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _uuid() -> str:
    return str(uuid.uuid4())


def test_delete_channel_404_unknown_id(client: TestClient) -> None:
    missing = _uuid()
    r = client.delete(f"/api/channels/{missing}")
    assert r.status_code == 404


def test_delete_channel_empty_no_collections(client: TestClient) -> None:
    ch_id = _uuid()
    name = f"empty-{ch_id[:8]}"
    db = SessionLocal()
    try:
        db.add(Channel(id=ch_id, name=name, created_at=datetime.utcnow()))
        db.commit()
    finally:
        db.close()

    r = client.delete(f"/api/channels/{ch_id}")
    assert r.status_code == 200
    assert r.json() == {"success": True, "id": ch_id}

    db2 = SessionLocal()
    try:
        assert db2.get(Channel, ch_id) is None
    finally:
        db2.close()


def test_delete_channel_cascade_jobs_collections(client: TestClient) -> None:
    ch_id = _uuid()
    coll_id = _uuid()
    job_id = _uuid()
    name = f"cascade-{ch_id[:8]}"
    db = SessionLocal()
    try:
        db.add(Channel(id=ch_id, name=name, created_at=datetime.utcnow()))
        db.add(Collection(id=coll_id, channel_id=ch_id, title="", created_at=datetime.utcnow()))
        db.add(
            Job(
                id=job_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                status=JobStatus.completed,
                original_filename="a.mp4",
                video_path="/tmp/x",
                job_source="file",
                collection_id=coll_id,
                duration_sec=1,
                stage="done",
                progress=1.0,
                error_message="",
                result_path="",
            )
        )
        db.commit()
    finally:
        db.close()

    r = client.delete(f"/api/channels/{ch_id}")
    assert r.status_code == 200, r.text
    assert r.json() == {"success": True, "id": ch_id}

    db2 = SessionLocal()
    try:
        assert db2.get(Channel, ch_id) is None
        assert db2.get(Collection, coll_id) is None
        assert db2.get(Job, job_id) is None
    finally:
        db2.close()


def test_delete_channel_cascade_youtube_videos_first(client: TestClient) -> None:
    """youtube_videos.job_id references jobs — must be removed before jobs (Postgres FK)."""
    ch_id = _uuid()
    coll_id = _uuid()
    job_id = _uuid()
    ingest_id = _uuid()
    ytv_id = _uuid()
    name = f"ytv-{ch_id[:8]}"

    db = SessionLocal()
    try:
        db.add(
            YouTubeIngest(
                id=ingest_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                channel_handle="@testhandle",
                requested_video_count=1,
                status=YouTubeIngestStatus.queued,
                message="",
            )
        )
        db.add(Channel(id=ch_id, name=name, created_at=datetime.utcnow()))
        db.add(Collection(id=coll_id, channel_id=ch_id, title="", created_at=datetime.utcnow()))
        db.add(
            Job(
                id=job_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                status=JobStatus.completed,
                original_filename="a.mp4",
                video_path="/tmp/x",
                job_source="file",
                collection_id=coll_id,
                duration_sec=1,
                stage="done",
                progress=1.0,
                error_message="",
                result_path="",
            )
        )
        db.add(
            YouTubeVideo(
                id=ytv_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                ingest_id=ingest_id,
                channel_handle="@testhandle",
                youtube_video_id="abc12345",
                title="",
                url="",
                video_path="",
                job_id=job_id,
                status=YouTubeVideoStatus.completed,
                error_message="",
            )
        )
        db.commit()
    finally:
        db.close()

    r = client.delete(f"/api/channels/{ch_id}")
    assert r.status_code == 200, r.text
    assert r.json() == {"success": True, "id": ch_id}

    db2 = SessionLocal()
    try:
        assert db2.get(Channel, ch_id) is None
        assert db2.get(Job, job_id) is None
        assert db2.execute(select(YouTubeVideo).where(YouTubeVideo.id == ytv_id)).scalar_one_or_none() is None
    finally:
        db2.close()
