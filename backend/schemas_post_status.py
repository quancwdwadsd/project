from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PostStatusChannel(BaseModel):
    schedule_id: int
    channel_id: int
    channel_name: str
    channel_type: str
    scheduled_time: datetime
    publish_status: str
    platform_post_id: Optional[str] = None
    published_url: Optional[str] = None


class PostStatusItem(BaseModel):
    id: int
    title: str
    campaign_tag: Optional[str] = None
    approval_status: str
    created_by: int
    created_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    channels: list[PostStatusChannel]


class PostStatusHistoryItem(BaseModel):
    id: int
    schedule_id: Optional[int] = None
    from_status: Optional[str] = None
    to_status: str
    changed_by: Optional[int] = None
    username: Optional[str] = None
    reason: Optional[str] = None
    created_at: Optional[datetime] = None


class PostStatusDetail(PostStatusItem):
    content: Optional[str] = None
    history: list[PostStatusHistoryItem]


class PostActivityItem(BaseModel):
    id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    action: str
    created_at: Optional[datetime] = None
