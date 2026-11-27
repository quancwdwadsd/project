from typing import Literal
from pydantic import AnyHttpUrl, BaseModel, Field


class PublishPostRequest(BaseModel):
    channels: list[Literal["facebook", "instagram"]] = Field(min_length=1)
    image_url: AnyHttpUrl | None = None


class PublishChannelResult(BaseModel):
    channel: str
    status: Literal["published", "failed"]
    platform_post_id: str | None = None
    error: str | None = None


class PublishPostResponse(BaseModel):
    post_id: int
    status: str
    results: list[PublishChannelResult]
