from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Schedule, Post, Channel, User
from schemas import (
    ScheduleCreate,
    ScheduleUpdate,
    ScheduleStatusUpdate,
    ScheduleResponse
)
from security import get_current_user, require_roles


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

    allowed_statuses = [
        "pending",
        "publishing",
        "published",
        "failed",
        "cancelled"
    ]

    if status_data.publish_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid schedule status"
        )

    schedule.publish_status = status_data.publish_status

    db.commit()
    db.refresh(schedule)

    return schedule


@router.delete("/{schedule_id}")
def delete_schedule(
    schedule_id: int,
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
            detail="Only pending schedules can be deleted"
        )

    db.delete(schedule)
    db.commit()

    return {
        "message": "Schedule deleted successfully"
    }
