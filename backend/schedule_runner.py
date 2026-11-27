import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from activity_logger import record_activity
from database import SessionLocal
from meta_publisher import MetaPublishError, publish_facebook, publish_instagram
from models import Channel, Post, Schedule
from status_history import record_post_status_change

logger = logging.getLogger(__name__)
POLL_SECONDS = max(5, int(os.getenv("SCHEDULE_POLL_SECONDS", "15")))


def utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def claim_due_schedule(db: Session):
    row = db.query(Schedule).join(Post, Post.id == Schedule.post_id).filter(
        Schedule.publish_status == "pending",
        Schedule.scheduled_time <= utc_now_naive(),
        Post.status == "approved",
    ).order_by(Schedule.scheduled_time.asc(), Schedule.id.asc()).with_for_update(skip_locked=True).first()
    if not row:
        return None
    row.publish_status = "publishing"
    db.commit()
    return row.id


async def publish_schedule(schedule_id: int) -> None:
    with SessionLocal() as db:
        schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not schedule or schedule.publish_status != "publishing":
            return
        post = db.query(Post).filter(Post.id == schedule.post_id).first()
        channel = db.query(Channel).filter(Channel.id == schedule.channel_id).first()
        if not post or not channel:
            error = "Không tìm thấy bài viết hoặc kênh đã lên lịch."
            schedule.publish_status = "failed"
            record_post_status_change(db, schedule.post_id, "failed", None,
                                      from_status="publishing", schedule_id=schedule.id, reason=error)
            db.commit()
            return

        before = "publishing"
        try:
            platform = (channel.channel_type or "").strip().lower()
            data = post.composer_data if isinstance(post.composer_data, dict) else {}
            caption = f"{post.title}\n\n{post.content or ''}".strip()
            if platform in {"facebook", "fb", "facebook_page"}:
                platform_post_id = await publish_facebook(caption)
            elif platform in {"instagram", "ig", "instagram_business"}:
                platform_post_id = await publish_instagram(caption, data.get("publicImageUrl"))
            else:
                raise MetaPublishError(f"Kênh '{channel.channel_type}' chưa được nối Meta Publisher.")
            schedule.publish_status = "published"
            schedule.platform_post_id = platform_post_id or None
            record_post_status_change(db, post.id, "published", None,
                                      from_status=before, schedule_id=schedule.id,
                                      reason=f"Đăng tự động qua {channel.channel_name}")
            record_activity(db, post.created_by,
                            f"Đã đăng bài #{post.id} lên {channel.channel_name}")
            other_schedules = db.query(Schedule).filter(
                Schedule.post_id == post.id,
                Schedule.id != schedule.id,
                Schedule.publish_status.notin_(["published", "cancelled"]),
            ).count()
            if not other_schedules:
                post.status = "published"
                record_post_status_change(db, post.id, "published", None,
                                          from_status="approved", reason="Đã đăng hết các lịch của bài")
        except MetaPublishError as error:
            schedule.publish_status = "failed"
            record_post_status_change(db, post.id, "failed", None,
                                      from_status=before, schedule_id=schedule.id, reason=str(error)[:500])
            record_activity(db, post.created_by,
                            f"Đăng bài #{post.id} thất bại trên {channel.channel_name}: {str(error)[:150]}")
        except Exception:
            logger.exception("Unexpected error while publishing schedule %s", schedule_id)
            schedule.publish_status = "failed"
            record_post_status_change(db, post.id, "failed", None,
                                      from_status=before, schedule_id=schedule.id,
                                      reason="Lỗi nội bộ khi xử lý lịch đăng.")
        db.commit()


async def run_due_schedules_once(batch_size: int = 10) -> int:
    claimed = []
    with SessionLocal() as db:
        for _ in range(batch_size):
            schedule_id = claim_due_schedule(db)
            if schedule_id is None:
                break
            claimed.append(schedule_id)
    for schedule_id in claimed:
        await publish_schedule(schedule_id)
    return len(claimed)


async def schedule_worker() -> None:
    logger.info("Schedule worker started; polling every %s seconds", POLL_SECONDS)
    while True:
        try:
            await run_due_schedules_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Schedule worker iteration failed")
        await asyncio.sleep(POLL_SECONDS)
