import asyncio
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

_cache = {"expires": 0.0, "value": None}
_cache_lock = asyncio.Lock()
CACHE_SECONDS = 300


def _version() -> str:
    value = os.getenv("META_GRAPH_API_VERSION", "v27.0").strip()
    return value if re.fullmatch(r"v\d+\.0", value) else "v27.0"


async def _get(client: httpx.AsyncClient, node: str, token: str, **params):
    response = await client.get(
        f"https://graph.facebook.com/{_version()}/{node.lstrip('/')}",
        params={**params, "access_token": token},
    )
    payload = response.json()
    if response.is_error or payload.get("error"):
        error = payload.get("error", {})
        message = error.get("error_user_msg") or error.get("message") or "Meta Insights request failed."
        raise RuntimeError(message)
    return payload


def _metric_value(payload: dict, metric: str) -> int:
    item = next((row for row in payload.get("data", []) if row.get("name") == metric), {})
    total = item.get("total_value")
    if isinstance(total, dict):
        total = total.get("value")
    if total is not None:
        return int(total or 0)
    values = item.get("values", [])
    result = 0
    for row in values:
        value = row.get("value", 0)
        if isinstance(value, dict):
            value = sum(v for v in value.values() if isinstance(v, (int, float)))
        if isinstance(value, (int, float)):
            result += int(value)
    return result


async def _load_meta_dashboard() -> dict:
    page_id = os.getenv("META_PAGE_ID", "").strip()
    page_token = os.getenv("META_PAGE_ACCESS_TOKEN", "").strip()
    ig_id = os.getenv("META_IG_USER_ID", "").strip()
    ig_token = os.getenv("META_IG_ACCESS_TOKEN", "").strip()
    result = {
        "facebook": {"connected": bool(page_id and page_token), "profile": None, "metrics": {}, "error": None, "daily_engagement": []},
        "instagram": {"connected": bool(ig_id and ig_token), "profile": None, "metrics": {}, "error": None},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    since = int((datetime.now(timezone.utc) - timedelta(days=28)).timestamp())
    until = int(datetime.now(timezone.utc).timestamp())
    week_since = int((datetime.now(timezone.utc) - timedelta(days=6)).timestamp())

    async with httpx.AsyncClient(timeout=25) as client:
        async def load_facebook():
            if not page_id or not page_token:
                return
            try:
                profile = await _get(client, page_id, page_token, fields="id,name,followers_count")
                result["facebook"]["profile"] = profile
                insights = await _get(client, f"{page_id}/insights", page_token,
                                      metric="page_post_engagements,page_media_view", period="days_28")
                result["facebook"]["metrics"] = {
                    "engagements_28d": _metric_value(insights, "page_post_engagements"),
                    "content_views_28d": _metric_value(insights, "page_media_view"),
                }
                daily = await _get(client, f"{page_id}/insights", page_token,
                                   metric="page_post_engagements", period="day", since=week_since, until=until)
                values = next((row.get("values", []) for row in daily.get("data", [])
                               if row.get("name") == "page_post_engagements"), [])
                result["facebook"]["daily_engagement"] = [int(row.get("value") or 0) for row in values][-7:]
            except Exception as error:
                result["facebook"]["error"] = str(error)

        async def load_instagram():
            if not ig_id or not ig_token:
                return
            try:
                profile = await _get(client, ig_id, ig_token, fields="id,username,followers_count,media_count")
                result["instagram"]["profile"] = profile
                insights = await _get(client, f"{ig_id}/insights", ig_token,
                                      metric="reach,total_interactions,views", period="days_28",
                                      since=since, until=until)
                result["instagram"]["metrics"] = {
                    "reach_28d": _metric_value(insights, "reach"),
                    "interactions_28d": _metric_value(insights, "total_interactions"),
                    "views_28d": _metric_value(insights, "views"),
                }
            except Exception as error:
                result["instagram"]["error"] = str(error)

        await asyncio.gather(load_facebook(), load_instagram())
    return result


async def get_meta_dashboard(force_refresh: bool = False) -> dict:
    if not force_refresh and _cache["value"] is not None and _cache["expires"] > time.monotonic():
        return _cache["value"]
    async with _cache_lock:
        if not force_refresh and _cache["value"] is not None and _cache["expires"] > time.monotonic():
            return _cache["value"]
        value = await _load_meta_dashboard()
        _cache.update(value=value, expires=time.monotonic() + CACHE_SECONDS)
        return value
