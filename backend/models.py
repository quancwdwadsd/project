from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    func,
    JSON
)
from database import Base
from sqlalchemy import ForeignKey, func


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    role_name = Column(String(50), nullable=False, unique=True)
    description = Column(Text)
    created_at = Column(DateTime, server_default=func.current_timestamp())


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), nullable=False, unique=True)
    full_name = Column(String(80), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    email = Column(String(100), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)

    role_id = Column(
        Integer,
        ForeignKey("roles.id"),
        nullable=False
    )

    status = Column(Boolean, default=True)
    created_at = Column(
        DateTime,
        server_default=func.current_timestamp()
    )
    updated_at = Column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp()
    )
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text)
    campaign_tag = Column(String(100))
    composer_data = Column(JSON, nullable=True)
    status = Column(String(30), default="draft")
    reject_reason = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_at = Column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp()
    )
    deleted_at = Column(DateTime, nullable=True, index=True)


class Channel(Base):
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, index=True)
    channel_type = Column(String(30), nullable=False)
    channel_name = Column(String(100), nullable=False)
    access_token = Column(Text)
    assigned_to = Column(Integer, ForeignKey("users.id"))
    status = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.current_timestamp())


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False)
    scheduled_time = Column(DateTime, nullable=False)
    publish_status = Column(String(30), default="pending")
    platform_post_id = Column(String(100))
    published_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, server_default=func.current_timestamp())


class PostStatusHistory(Base):
    __tablename__ = "post_status_history"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    schedule_id = Column(Integer, ForeignKey("schedules.id"), nullable=True, index=True)
    from_status = Column(String(30), nullable=True)
    to_status = Column(String(30), nullable=False)
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.current_timestamp())


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    assigned_to = Column(Integer, ForeignKey("users.id"))
    assigned_by = Column(Integer, ForeignKey("users.id"))
    status = Column(String(30), default="pending")
    priority = Column(String(20), nullable=False, default="medium")
    due_date = Column(DateTime)
    created_at = Column(DateTime, server_default=func.current_timestamp())


class Media(Base):
    __tablename__ = "media"

    id = Column(Integer, primary_key=True, index=True)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(255), nullable=False)
    file_type = Column(String(50))
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())


class Interaction(Base):
    __tablename__ = "interactions"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False)
    interaction_type = Column(String(30))
    content = Column(Text)
    sender_name = Column(String(100))
    received_at = Column(
        DateTime,
        server_default=func.current_timestamp()
    )


class PostMetric(Base):
    __tablename__ = "post_metrics"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False)
    likes = Column(Integer, default=0)
    comments = Column(Integer, default=0)
    shares = Column(Integer, default=0)
    views = Column(Integer, default=0)
    source = Column(String(30))
    collected_at = Column(
        DateTime,
        server_default=func.current_timestamp()
    )

class PostMedia(Base):
    __tablename__ = "post_media"

    post_id = Column(
        Integer,
        ForeignKey("posts.id"),
        primary_key=True
    )

    media_id = Column(
        Integer,
        ForeignKey("media.id"),
        primary_key=True
    )
    
class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(255), nullable=False)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, server_default=func.current_timestamp())
