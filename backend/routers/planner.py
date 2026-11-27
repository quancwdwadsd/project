from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from activity_logger import record_activity
from database import get_db
from models import Channel, Post, Role, Schedule, User
from schemas_planner import PlannerData, PlannerEvent, PlannerPost, PlannerChannel, PlannerScheduleCreate
from security import get_current_user

router = APIRouter(prefix="/planner", tags=["Planner"])


def user_role(db: Session, user: User) -> str:
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return role.role_name.lower() if role else ""


@router.get("/", response_model=PlannerData)
def get_planner_data(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user_role(db, user)
    if role not in {"admin", "manager", "editor", "employee"}:
        raise HTTPException(status_code=403, detail="Vai trò không có quyền xem lịch xuất bản")

    channels_query = db.query(Channel).filter(Channel.status.is_(True))
    if role in {"editor", "employee"}:
        channels_query = channels_query.filter(or_(Channel.assigned_to == user.id, Channel.assigned_to.is_(None)))
    channels = channels_query.order_by(Channel.channel_name.asc()).all()

    posts_query = db.query(Post)
    if role in {"editor", "employee"}:
        posts_query = posts_query.filter(Post.created_by == user.id)
    posts = posts_query.order_by(Post.updated_at.desc(), Post.id.desc()).all()

    schedules_query = db.query(Schedule, Post, Channel).join(
        Post, Post.id == Schedule.post_id
    ).join(Channel, Channel.id == Schedule.channel_id)
    if role in {"editor", "employee"}:
        schedules_query = schedules_query.filter(
            (Post.created_by == user.id) | (Channel.assigned_to == user.id)
        )
    if start:
        schedules_query = schedules_query.filter(Schedule.scheduled_time >= start)
    if end:
        schedules_query = schedules_query.filter(Schedule.scheduled_time < end)
    rows = schedules_query.order_by(Schedule.scheduled_time.asc()).all()

    return {
        "events": [PlannerEvent(
            schedule_id=schedule.id, post_id=post.id, title=post.title,
            channel_id=channel.id, channel_name=channel.channel_name,
            channel_type=channel.channel_type, scheduled_time=schedule.scheduled_time,
            publish_status=schedule.publish_status or "pending",
        ) for schedule, post, channel in rows],
        "posts": [PlannerPost(id=post.id, title=post.title, status=post.status or "draft") for post in posts],
        "channels": [PlannerChannel(id=channel.id, channel_name=channel.channel_name, channel_type=channel.channel_type) for channel in channels],
    }


@router.post("/", response_model=PlannerEvent, status_code=201)
def create_planner_schedule(
    data: PlannerScheduleCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user_role(db, user)
    post = db.query(Post).filter(Post.id == data.post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Bài viết không tồn tại")
    if post.status not in {"draft", "pending", "approved", "rejected"}:
        raise HTTPException(status_code=409, detail="Bài viết hiện không thể lên lịch")
    if role not in {"admin", "manager"} and post.created_by != user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền lên lịch bài viết này")

    scheduled_time = data.scheduled_time
    if scheduled_time.tzinfo is not None:
        scheduled_time = scheduled_time.astimezone(timezone.utc).replace(tzinfo=None)
    if scheduled_time <= datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status_code=422, detail="Thời gian lên lịch phải ở tương lai")

    channel = db.query(Channel).filter(Channel.id == data.channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Kênh truyền thông không tồn tại")
    if not channel.status:
        raise HTTPException(status_code=400, detail="Kênh truyền thông đang tắt")
    if role in {"editor", "employee"} and channel.assigned_to not in {None, user.id}:
        raise HTTPException(status_code=403, detail="Bạn không được phân công cho kênh này")

    schedule = db.query(Schedule).filter(
        Schedule.post_id == post.id,
        Schedule.channel_id == channel.id,
        Schedule.publish_status == "pending",
    ).order_by(Schedule.id.desc()).first()
    if schedule:
        schedule.scheduled_time = scheduled_time
    else:
        schedule = Schedule(
            post_id=post.id, channel_id=channel.id,
            scheduled_time=scheduled_time, publish_status="pending",
        )
        db.add(schedule)
    db.flush()
    record_activity(
        db, user.id, f"Lên lịch bài #{post.id} trên {channel.channel_name}",
        request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(schedule)
    return PlannerEvent(
        schedule_id=schedule.id, post_id=post.id, title=post.title,
        channel_id=channel.id, channel_name=channel.channel_name,
        channel_type=channel.channel_type, scheduled_time=schedule.scheduled_time,
        publish_status=schedule.publish_status or "pending",
    )
