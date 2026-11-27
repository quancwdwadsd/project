import os
import re
from html import unescape
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


class MetaPublishError(Exception):
    pass


def _graph_version() -> str:
    version = os.getenv("META_GRAPH_API_VERSION", "v27.0").strip()
    return version if re.fullmatch(r"v\d+\.0", version) else "v27.0"


def _plain_text(value: str | None) -> str:
    value = re.sub(r"<\s*br\s*/?>|</p\s*>", "\n", value or "", flags=re.I)
    return unescape(re.sub(r"<[^>]+>", "", value)).strip()


async def _post(path: str, token: str, data: dict) -> dict:
    url = f"https://graph.facebook.com/{_graph_version()}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, data={**data, "access_token": token})
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MetaPublishError("Không kết nối được Meta Graph API.") from exc
    if response.is_error or "error" in payload:
        error = payload.get("error", {})
        raise MetaPublishError(error.get("error_user_msg") or error.get("message") or "Meta từ chối yêu cầu đăng bài.")
    return payload


async def publish_facebook(message: str) -> str:
    page_id = os.getenv("META_PAGE_ID", "").strip()
    token = os.getenv("META_PAGE_ACCESS_TOKEN", "").strip()
    if not page_id:
        raise MetaPublishError("Thiếu META_PAGE_ID trong backend/.env.")
    if not token:
        raise MetaPublishError("Thiếu META_PAGE_ACCESS_TOKEN trong backend/.env.")
    result = await _post(f"{page_id}/feed", token, {"message": _plain_text(message)})
    return str(result.get("id", ""))


async def publish_instagram(caption: str, image_url: str | None) -> str:
    ig_user_id = os.getenv("META_IG_USER_ID", "").strip()
    token = os.getenv("META_IG_ACCESS_TOKEN", "").strip()
    if not ig_user_id:
        raise MetaPublishError("Thiếu META_IG_USER_ID trong backend/.env.")
    if not token:
        raise MetaPublishError("Thiếu META_IG_ACCESS_TOKEN trong backend/.env.")
    if not image_url:
        raise MetaPublishError("Instagram cần ảnh có URL công khai; file đang chọn trong composer hiện chỉ nằm trên máy người dùng.")
    container = await _post(f"{ig_user_id}/media", token, {
        "image_url": image_url,
        "caption": _plain_text(caption)[:2200],
    })
    creation_id = container.get("id")
    if not creation_id:
        raise MetaPublishError("Meta không trả về ID media container cho Instagram.")
    published = await _post(f"{ig_user_id}/media_publish", token, {"creation_id": creation_id})
    return str(published.get("id", ""))
