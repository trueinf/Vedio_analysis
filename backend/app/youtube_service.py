from __future__ import annotations

import re
from typing import Any

import httpx

from app.settings import settings


def normalize_channel_handle(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    # Accept "@handle", "handle", or full URL.
    s = re.sub(r"^https?://(www\.)?youtube\.com/", "", s, flags=re.IGNORECASE)
    s = s.strip().strip("/")
    if s.lower().startswith("@"):
        return "@" + s[1:].strip()
    # URLs like "c/Name" or "channel/UC..." -> return as-is token for lookup
    if s.lower().startswith("channel/"):
        return s.split("/", 1)[1].strip()
    if s.lower().startswith("c/"):
        return "@" + s.split("/", 1)[1].strip()
    return "@" + s


def _require_api_key() -> str:
    key = (settings.youtube_api_key or "").strip()
    if not key:
        raise RuntimeError("Missing YOUTUBE_API_KEY (set youtube_api_key in backend .env)")
    return key


def resolve_channel_id(handle_or_uc: str) -> dict[str, str]:
    """
    Returns {"channel_id": "...", "title": "...", "handle": normalized_handle_or_uc}.
    """
    token = normalize_channel_handle(handle_or_uc)
    if not token:
        raise RuntimeError("Empty channel")

    key = _require_api_key()
    with httpx.Client(timeout=30.0) as client:
        # If already UC..., fetch directly.
        if token.startswith("UC"):
            r = client.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "snippet", "id": token, "key": key},
            )
            r.raise_for_status()
            data = r.json()
            items = data.get("items") or []
            if not items:
                raise RuntimeError("Channel not found")
            sn = (items[0].get("snippet") or {}) if isinstance(items[0], dict) else {}
            return {"channel_id": token, "title": str(sn.get("title") or ""), "handle": token}

        q = token.lstrip("@")
        r = client.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "part": "snippet",
                "type": "channel",
                "q": q,
                "maxResults": 1,
                "key": key,
            },
        )
        r.raise_for_status()
        data = r.json()
        items = data.get("items") or []
        if not items:
            raise RuntimeError("Channel not found")
        it = items[0] if isinstance(items[0], dict) else {}
        ch_id = str(((it.get("snippet") or {}).get("channelId")) or ((it.get("id") or {}).get("channelId")) or "")
        title = str(((it.get("snippet") or {}).get("channelTitle")) or ((it.get("snippet") or {}).get("title")) or "")
        if not ch_id:
            raise RuntimeError("Failed to resolve channel id")
        return {"channel_id": ch_id, "title": title, "handle": token}


def list_recent_videos(channel_id: str, limit: int = 10) -> list[dict[str, Any]]:
    key = _require_api_key()
    limit = max(1, min(int(limit or 10), 50))
    with httpx.Client(timeout=30.0) as client:
        r = client.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "part": "snippet",
                "channelId": channel_id,
                "maxResults": limit,
                "order": "date",
                "type": "video",
                "key": key,
            },
        )
        r.raise_for_status()
        data = r.json()
        out: list[dict[str, Any]] = []
        for it in (data.get("items") or []):
            if not isinstance(it, dict):
                continue
            vid = str(((it.get("id") or {}).get("videoId")) or "")
            sn = it.get("snippet") or {}
            if not vid:
                continue
            out.append(
                {
                    "video_id": vid,
                    "title": str(sn.get("title") or ""),
                    "url": f"https://www.youtube.com/watch?v={vid}",
                }
            )
        return out

