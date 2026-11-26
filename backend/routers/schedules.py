from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from models import Schedule, Post, Channel, Role, User
from schemas import (
    ScheduleCreate,
    ScheduleUpdate,
    ScheduleStatusUpdate,
    ScheduleResponse
)
from security import get_current_user, require_roles
from activity_logger import record_activity
from status_history import record_post_status_change


router = APIRouter(
    prefix="/schedules",
    tags=["Schedules"]
)


@router.get("/", response_model=list[ScheduleResponse])
def get_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Schedule).order_by(
        Schedule.scheduled_time.asc()
    ).all()


@router.get("/{schedule_id}", response_model=ScheduleResponse)
def get_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    schedule = db.query(Schedule).filter(
        Schedule.id == schedule_id
    ).first()

    if not schedule:
        raise HTTPException(
            status_code=404,
            detail="Schedule not found"
        )

    return schedule


@router.post("/", response_model=ScheduleResponse)
def create_schedule(
    schedule_data: ScheduleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    post = db.query(Post).filter(
        Post.id == schedule_data.post_id
    ).first()

    if not post:
        raise HTTPException(
            status_code=404,
            detail="Post not found"
        )

    if post.status != "approved":
        raise HTTPException(
            status_code=400,
            detail="Post must be approved before scheduling"
        )

    channel = db.query(Channel).filter(
        Channel.id == schedule_data.channel_id
    ).first()

    if not channel:
        raise HTTPException(
            status_code=404,
            detail="Channel not found"
        )

    if not channel.status:
        raise HTTPException(
            status_code=400,
            detail="Channel is disabled"
        )

    schedule = Schedule(
        post_id=schedule_data.post_id,
        channel_id=schedule_data.channel_id,
        scheduled_time=schedule_data.scheduled_time,
        publish_status="pending"
    )

    db.add(schedule)
    db.flush()
    record_post_status_change(
        db, post.id, "pending", current_user.id,
        schedule_id=schedule.id, reason=f"Lên lịch trên kênh {channel.channel_name}"
    )
    record_activity(
        db, current_user.id, f"Lên lịch bài #{post.id} trên {channel.channel_name}",
        request.client.host if request.client else None
    )
    db.commit()
    db.refresh(schedule)

    return schedule


@router.put("/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(
    schedule_id: int,
    schedule_data: ScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    schedule = db.query(Schedule).filter(
        Schedule.id == schedule_id
    ).first()

    if not schedule:
        raise HTTPException(
            status_code=404,
            detail="Schedule not found"
        )

    if schedule.publish_status != "pending":
        raise HTTPException(
            status_code=400,
            detail="Only pending schedules can be updated"
        )

    if schedule_data.scheduled_time is not None:
        schedule.scheduled_time = schedule_data.scheduled_time

    db.commit()
    db.refresh(schedule)

    return schedule


@router.patch("/{schedule_id}/status", response_model=ScheduleResponse)
def update_schedule_status(
    schedule_id: int,
    status_data: ScheduleStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    schedule = db.query(Schedule).filter(
        Schedule.id == schedule_id
    ).with_for_update().first()

    if not schedule:
        raise HTTPException(
            status_code=404,
            detail="Schedule not found"
        )

    role = db.query(Role).filter(Role.id == current_user.role_id).first()
    channel = db.query(Channel).filter(Channel.id == schedule.channel_id).first()
    role_name = role.role_name.lower() if role else ""
    can_manage = role_name in {"admin", "manager"}
    can_edit_assigned = role_name in {"editor", "employee"} and channel and channel.assigned_to == current_user.id
    if not (can_manage or can_edit_assigned):
        raise HTTPException(status_code=403, detail="Bạn không có quyền cập nhật lịch đăng này")

    transitions = {
        "pending": {"publishing", "published", "failed", "cancelled"},
        "publishing": {"published", "failed"},
        "failed": {"pending"},
        "published": set(),
        "cancelled": set(),
    }
    previous_status = schedule.publish_status or "pending"

    if previous_status not in transitions:
        raise HTTPException(status_code=409, detail="Trạng thái lịch đăng hiện tại không hợp lệ")

    if status_data.publish_status not in transitions:
        raise HTTPException(
            status_code=400,
            detail="Invalid schedule status"
        )

    if status_data.publish_status != previous_status and status_data.publish_status not in transitions[previous_status]:
        raise HTTPException(status_code=409, detail="Không thể chuyển trạng thái theo luồng hiện tại")

    schedule.publish_status = status_data.publish_status
    if status_data.platform_post_id is not None:
        schedule.platform_post_id = status_data.platform_post_id.strip() or None
    if status_data.published_url is not None:
        schedule.published_url = str(status_data.published_url)
    if status_data.publish_status != previous_status:
        record_post_status_change(
            db, schedule.post_id, schedule.publish_status, current_user.id,
            from_status=previous_status, schedule_id=schedule.id, reason=status_data.reason
        )
        status_label = {
            "pending": "Đã lên lịch", "publishing": "Đang đăng", "published": "Đã đăng",
            "failed": "Thất bại", "cancelled": "Đã hủy",
        }[schedule.publish_status]
        activity_text = (
            f"Cập nhật bài #{schedule.post_id} trên {channel.channel_name}: {status_label}"
            + (f" — {status_data.reason.strip()}" if status_data.reason and status_data.reason.strip() else "")
        )
        record_activity(db, current_user.id, activity_text[:255], request.client.host if request.client else None)

    db.commit()
    db.refresh(schedule)

    return schedule


@router.delete("/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    schedule = db.query(Schedule).filter(
        Schedule.id == schedule_id
    ).with_for_update().first()

    if not schedule:
        raise HTTPException(
            status_code=404,
            detail="Schedule not found"
        )

    if schedule.publish_status != "pending":
        raise HTTPException(
            status_code=400,
            detail="Only pending schedules can be deleted"
        )

    channel = db.query(Channel).filter(Channel.id == schedule.channel_id).first()
    previous_status = schedule.publish_status or "pending"
    schedule.publish_status = "cancelled"
    record_post_status_change(
        db, schedule.post_id, "cancelled", current_user.id,
        from_status=previous_status, schedule_id=schedule.id, reason="Hủy lịch đăng"
    )
    record_activity(
        db, current_user.id, f"Hủy lịch bài #{schedule.post_id} trên {channel.channel_name if channel else 'kênh'}",
        request.client.host if request.client else None
    )
    db.commit()

    return {
        "message": "Schedule cancelled successfully"
    }
