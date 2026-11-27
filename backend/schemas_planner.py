from datetime import datetime
from pydantic import BaseModel, Field


class PlannerScheduleCreate(BaseModel):
    post_id: int = Field(ge=1)
    channel_id: int = Field(ge=1)
    scheduled_time: datetime


class PlannerEvent(BaseModel):
    schedule_id: int
    post_id: int
    title: str
    channel_id: int
    channel_name: str
    channel_type: str
    scheduled_time: datetime
    publish_status: str


class PlannerPost(BaseModel):
    id: int
    title: str
    status: str


class PlannerChannel(BaseModel):
    id: int
    channel_name: str
    channel_type: str


class PlannerData(BaseModel):
    events: list[PlannerEvent]
    posts: list[PlannerPost]
    channels: list[PlannerChannel]
