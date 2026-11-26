from pydantic import BaseModel, Field, EmailStr
from datetime import datetime
from typing import Optional


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr = Field(max_length=100)
    password: str = Field(min_length=8)
    role_id: int
    status: bool = True


class UserAccessUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    role_id: int
    status: bool


class UserUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr


class UserRoleUpdate(BaseModel):
    role_id: int


class UserStatusUpdate(BaseModel):
    status: bool


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    role_id: int
    role_name: str
    status: bool


class UserLogin(BaseModel):
    username_or_email: str
    password: str


class UserRegister(BaseModel):
    full_name: str = Field(min_length=2, max_length=80)
    email: EmailStr = Field(max_length=100)
    password: str = Field(min_length=8, max_length=72)


class AuthUserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    email: str
    role_id: int
    role_name: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: AuthUserResponse
    
class PostCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: Optional[str] = None
    campaign_tag: Optional[str] = Field(default=None, max_length=100)
    composer_data: Optional[dict] = None


class PostUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    content: Optional[str] = None
    campaign_tag: Optional[str] = Field(default=None, max_length=100)
    composer_data: Optional[dict] = None


class PostStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=30)
    reject_reason: Optional[str] = None


class PostResponse(BaseModel):
    id: int
    title: str
    content: Optional[str]
    campaign_tag: Optional[str]
    composer_data: Optional[dict] = None
    status: str
    reject_reason: Optional[str]
    created_by: int
    approved_by: Optional[int]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class ChannelCreate(BaseModel):
    channel_type: str = Field(min_length=1, max_length=30)
    channel_name: str = Field(min_length=1, max_length=100)
    assigned_to: Optional[int] = None


class ChannelUpdate(BaseModel):
    channel_type: Optional[str] = Field(default=None, max_length=30)
    channel_name: Optional[str] = Field(default=None, max_length=100)
    assigned_to: Optional[int] = None
    status: Optional[bool] = None


class ChannelResponse(BaseModel):
    id: int
    channel_type: str
    channel_name: str
    assigned_to: Optional[int]
    status: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class ScheduleCreate(BaseModel):
    post_id: int
    channel_id: int
    scheduled_time: datetime


class ScheduleUpdate(BaseModel):
    scheduled_time: Optional[datetime] = None


class ScheduleStatusUpdate(BaseModel):
    publish_status: str = Field(min_length=1, max_length=30)


class ScheduleResponse(BaseModel):
    id: int
    post_id: int
    channel_id: int
    scheduled_time: datetime
    publish_status: str
    platform_post_id: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None


class TaskStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=30)


class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    assigned_to: Optional[int]
    assigned_by: Optional[int]
    status: str
    due_date: Optional[datetime]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class MediaResponse(BaseModel):
    id: int
    file_name: str
    file_path: str
    file_type: Optional[str]
    uploaded_by: Optional[int]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class InteractionCreate(BaseModel):
    channel_id: int
    interaction_type: Optional[str] = None
    content: Optional[str] = None
    sender_name: Optional[str] = Field(default=None, max_length=100)


class InteractionResponse(BaseModel):
    id: int
    channel_id: int
    interaction_type: Optional[str]
    content: Optional[str]
    sender_name: Optional[str]
    received_at: Optional[datetime]

    class Config:
        from_attributes = True


class PostMetricCreate(BaseModel):
    post_id: int
    likes: int = Field(default=0, ge=0)
    comments: int = Field(default=0, ge=0)
    shares: int = Field(default=0, ge=0)
    views: int = Field(default=0, ge=0)
    source: Optional[str] = Field(default=None, max_length=30)


class PostMetricResponse(BaseModel):
    id: int
    post_id: int
    likes: Optional[int]
    comments: Optional[int]
    shares: Optional[int]
    views: Optional[int]
    source: Optional[str]
    collected_at: Optional[datetime]

    class Config:
        from_attributes = True

class PostMediaCreate(BaseModel):
    media_id: int


class PostMediaResponse(BaseModel):
    post_id: int
    media_id: int
    
class ActivityLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    action: str
    ip_address: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
