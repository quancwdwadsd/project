from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import Channel, Post, PostMetric, Schedule, Task, User
from security import get_current_user


router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def _metric_totals(db: Session, start: datetime, end: datetime) -> dict[int, dict[str, int]]:
    rows = db.query(PostMetric).filter(
        PostMetric.collected_at >= start,
        PostMetric.collected_at < end,
    ).order_by(PostMetric.collected_at.desc(), PostMetric.id.desc()).all()

    latest_by_post: dict[int, dict[str, int]] = {}
    for row in rows:
        if row.post_id in latest_by_post:
            continue
        latest_by_post[row.post_id] = {
            "views": row.views or 0,
            "engagement": (row.likes or 0) + (row.comments or 0) + (row.shares or 0),
        }
    return latest_by_post


def _sum_metric(totals: dict[int, dict[str, int]], key: str) -> int:
    return sum(item[key] for item in totals.values())


@router.get("/summary")
def get_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now()
    period_start = now - timedelta(days=30)
    previous_start = period_start - timedelta(days=30)

    current_metrics = _metric_totals(db, period_start, now + timedelta(microseconds=1))
    previous_metrics = _metric_totals(db, previous_start, period_start)
    current_engagement = _sum_metric(current_metrics, "engagement")
    previous_engagement = _sum_metric(previous_metrics, "engagement")
    current_reach = _sum_metric(current_metrics, "views")

    weekly_metrics = db.query(PostMetric).filter(
        PostMetric.collected_at >= period_start,
        PostMetric.collected_at <= now,
    ).order_by(PostMetric.collected_at.desc(), PostMetric.id.desc()).all()
    week_snapshots: dict[tuple[int, int], PostMetric] = {}
    for row in weekly_metrics:
        week_index = min(4, max(0, (row.collected_at.date() - period_start.date()).days // 7))
        week_snapshots.setdefault((row.post_id, week_index), row)

    weekly_engagement = [0, 0, 0, 0, 0]
    for (_, week_index), row in week_snapshots.items():
        weekly_engagement[week_index] += (row.likes or 0) + (row.comments or 0) + (row.shares or 0)

    completed_tasks = db.query(Task).filter(Task.status == "completed").count()
    open_tasks = db.query(Task).filter(Task.status.in_(["pending", "in_progress"])).count()
    published_posts = db.query(Schedule.post_id).filter(
        Schedule.publish_status == "published",
        Schedule.scheduled_time >= period_start,
        Schedule.scheduled_time <= now,
    ).distinct().count()

    next_schedule = db.query(
        Schedule.scheduled_time,
        Post.title,
        Channel.channel_name,
        Channel.channel_type,
    ).join(
        Post, Schedule.post_id == Post.id
    ).join(
        Channel, Schedule.channel_id == Channel.id
    ).filter(
        Schedule.scheduled_time >= now,
        Schedule.publish_status == "pending",
        Channel.status.is_(True),
    ).order_by(Schedule.scheduled_time.asc()).first()

    recent_posts = db.query(Post).order_by(Post.updated_at.desc(), Post.id.desc()).limit(5).all()

    engagement_change = None
    if previous_engagement > 0:
        engagement_change = round(
            (current_engagement - previous_engagement) / previous_engagement * 100, 1
        )

    return {
        "period_days": 30,
        "engagement": current_engagement,
        "engagement_change_percent": engagement_change,
        "reach": current_reach,
        "published_posts": published_posts,
        "active_channels": db.query(Channel).filter(Channel.status.is_(True)).count(),
        "completed_tasks": completed_tasks,
        "open_tasks": open_tasks,
        "weekly_engagement": weekly_engagement,
        "has_metrics": bool(current_metrics),
        "next_schedule": None if not next_schedule else {
            "scheduled_time": next_schedule[0].isoformat(),
            "post_title": next_schedule[1],
            "channel_name": next_schedule[2],
            "channel_type": next_schedule[3],
        },
        "recent_activity": [
            {
                "id": post.id,
                "title": post.title,
                "status": post.status or "draft",
                "updated_at": post.updated_at.isoformat() if post.updated_at else None,
            }
            for post in recent_posts
        ],
    }
