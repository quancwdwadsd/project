from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Channel, Post, PostMetric, Schedule, User
from security import require_roles


router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/")
def get_report(
    start_date: date = Query(...),
    end_date: date = Query(...),
    channel_id: int | None = None,
    campaign_tag: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager", "Viewer")),
):
    """Read-only report over collected post-metric snapshots."""
    if start_date > end_date:
        raise HTTPException(status_code=422, detail="Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.")

    start_at = datetime.combine(start_date, time.min)
    end_exclusive = datetime.combine(end_date + timedelta(days=1), time.min)
    query = (
        db.query(PostMetric, Post)
        .join(Post, Post.id == PostMetric.post_id)
        .filter(PostMetric.collected_at >= start_at, PostMetric.collected_at < end_exclusive)
    )
    if campaign_tag:
        query = query.filter(Post.campaign_tag == campaign_tag)
    if status:
        query = query.filter(Post.status == status)
    if channel_id:
        query = query.filter(
            db.query(Schedule.id).filter(
                Schedule.post_id == Post.id,
                Schedule.channel_id == channel_id,
            ).exists()
        )

    rows = query.order_by(PostMetric.collected_at.asc(), PostMetric.id.asc()).all()
    channels_by_post = defaultdict(dict)
    matched_post_ids = {post.id for _, post in rows}
    if matched_post_ids:
        schedules = (
            db.query(Schedule, Channel)
            .join(Channel, Channel.id == Schedule.channel_id)
            .filter(Schedule.post_id.in_(matched_post_ids))
            .all()
        )
        for schedule, channel in schedules:
            channels_by_post[schedule.post_id][channel.id] = channel.channel_name

    # Metrics are cumulative snapshots. Keep the latest snapshot in the selected range per post.
    latest = {}
    snapshots_by_day = defaultdict(dict)
    for metric, post in rows:
        latest[post.id] = (metric, post)
        day = metric.collected_at.date().isoformat()
        snapshots_by_day[day][post.id] = metric

    def metric_values(metric):
        return {
            "views": metric.views or 0,
            "likes": metric.likes or 0,
            "comments": metric.comments or 0,
            "shares": metric.shares or 0,
            "interactions": (metric.likes or 0) + (metric.comments or 0) + (metric.shares or 0),
        }

    totals = {key: sum(metric_values(metric)[key] for metric, _ in latest.values()) for key in ("views", "likes", "comments", "shares", "interactions")}
    if not latest:
        totals = {key: None for key in totals}

    posts_by_channel = defaultdict(lambda: {"posts": 0, "views": 0, "interactions": 0})
    unassigned_multi_channel = 0
    top_posts = []
    for post_id, (metric, post) in latest.items():
        channel_map = channels_by_post.get(post_id, {})
        if len(channel_map) == 1:
            channel_name = next(iter(channel_map.values()))
            bucket = posts_by_channel[channel_name]
            bucket["posts"] += 1
            values = metric_values(metric)
            bucket["views"] += values["views"]
            bucket["interactions"] += values["interactions"]
        elif len(channel_map) > 1:
            unassigned_multi_channel += 1
        values = metric_values(metric)
        top_posts.append({
            "post_id": post.id,
            "title": post.title,
            "campaign_tag": post.campaign_tag,
            "status": post.status,
            "channels": list(channel_map.values()),
            "views": values["views"],
            "interactions": values["interactions"],
            "likes": values["likes"],
            "comments": values["comments"],
            "shares": values["shares"],
            "source": metric.source or "Không rõ",
            "collected_at": metric.collected_at.isoformat() if metric.collected_at else None,
        })

    trend = []
    for day, daily in sorted(snapshots_by_day.items()):
        vals = [metric_values(metric) for metric in daily.values()]
        trend.append({"date": day, "views": sum(item["views"] for item in vals), "interactions": sum(item["interactions"] for item in vals), "posts": len(vals)})

    top_posts.sort(key=lambda item: (item["interactions"], item["views"]), reverse=True)
    latest_update = max((metric.collected_at for metric, _ in latest.values() if metric.collected_at), default=None)
    sources = sorted({metric.source or "Không rõ" for metric, _ in latest.values()})
    return {
        "scope": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "channel_id": channel_id, "campaign_tag": campaign_tag, "status": status},
        "summary": {**totals, "posts_with_metrics": len(latest)},
        "trend": trend,
        "by_channel": [{"channel_name": name, **data} for name, data in sorted(posts_by_channel.items(), key=lambda item: item[1]["interactions"], reverse=True)],
        "top_posts": top_posts[:20],
        "filters": {
            "channels": [{"id": channel.id, "name": channel.channel_name} for channel in db.query(Channel).order_by(Channel.channel_name).all()],
            "campaigns": [row[0] for row in db.query(Post.campaign_tag).filter(Post.campaign_tag.isnot(None), Post.campaign_tag != "").distinct().order_by(Post.campaign_tag).all()],
            "statuses": [row[0] for row in db.query(Post.status).filter(Post.status.isnot(None)).distinct().order_by(Post.status).all()],
        },
        "data_quality": {
            "sources": sources,
            "updated_at": latest_update.isoformat() if latest_update else None,
            "multi_channel_posts_not_attributed": unassigned_multi_channel,
            "note": "Lượt xem và tương tác đang được lưu theo bài đăng, chưa tách theo kênh. Bài đa kênh không được phân bổ vào so sánh hiệu quả theo kênh.",
        },
    }
