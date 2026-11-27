from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from meta_insights import get_meta_dashboard
from models import ActivityLog, Channel, Post, Role, Schedule, Task, User
from security import get_current_user

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def _role_name(db: Session, user: User) -> str:
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return (role.role_name if role else "").lower()


@router.get("/summary")
async def dashboard_summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = _role_name(db, user)
    manager = role in {"admin", "manager"}
    channels = db.query(Channel).filter(Channel.status.is_(True))
    schedules = db.query(Schedule).join(Post, Post.id == Schedule.post_id)
    if not manager:
        channels = channels.filter(or_(Channel.assigned_to == user.id, Channel.assigned_to.is_(None)))
        schedules = schedules.filter(Post.created_by == user.id)

    start = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=28)
    published_count = schedules.filter(
        Schedule.publish_status == "published",
        Schedule.scheduled_time >= start,
    ).count()
    connected_channels = channels.count()

    task_query = db.query(Task)
    if not manager:
        task_query = task_query.filter(Task.assigned_to == user.id)
    completed_tasks = task_query.filter(Task.status == "completed").count()
    open_tasks = task_query.filter(Task.status.notin_(["completed", "cancelled"])).count()

    upcoming_query = db.query(Schedule, Post, Channel).join(
        Post, Post.id == Schedule.post_id
    ).join(Channel, Channel.id == Schedule.channel_id).filter(
        Schedule.publish_status == "pending",
        Schedule.scheduled_time >= datetime.now(timezone.utc).replace(tzinfo=None),
    )
    if not manager:
        upcoming_query = upcoming_query.filter(or_(Post.created_by == user.id, Channel.assigned_to == user.id))
    upcoming = upcoming_query.order_by(Schedule.scheduled_time.asc()).first()

    activity_query = db.query(ActivityLog).order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
    if not manager:
        activity_query = activity_query.filter(ActivityLog.user_id == user.id)
    activities = activity_query.limit(5).all()
    users = {row.id: row.full_name or row.username for row in db.query(User).filter(
        User.id.in_({activity.user_id for activity in activities if activity.user_id is not None})
    ).all()} if activities else {}

    upcoming_data = None
    if upcoming:
        schedule, post, channel = upcoming
        upcoming_data = {
            "title": post.title,
            "channel_name": channel.channel_name,
            "channel_type": channel.channel_type,
            "scheduled_time": schedule.scheduled_time.isoformat() + "Z",
        }

    meta = await get_meta_dashboard()
    return {
        "meta": meta,
        "database": {
            "published_posts_28d": published_count,
            "connected_channels": connected_channels,
            "completed_tasks": completed_tasks,
            "open_tasks": open_tasks,
            "upcoming": upcoming_data,
            "activities": [{
                "action": activity.action,
                "user": users.get(activity.user_id),
                "created_at": activity.created_at.isoformat() if activity.created_at else None,
            } for activity in activities],
        },
    }
