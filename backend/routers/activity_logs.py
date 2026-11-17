from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ActivityLog, User
from schemas import ActivityLogResponse
from security import get_current_user, require_roles

router = APIRouter(
    prefix="/activity-logs",
    tags=["Activity Logs"]
)


@router.get("/", response_model=list[ActivityLogResponse])
def get_activity_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    logs = db.query(ActivityLog).order_by(
        ActivityLog.created_at.desc()
    ).all()

    return logs


@router.get("/{log_id}", response_model=ActivityLogResponse)
def get_activity_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    log = db.query(ActivityLog).filter(
        ActivityLog.id == log_id
    ).first()

    if not log:
        raise HTTPException(
            status_code=404,
            detail="Khong tim thay nhat ky hoat dong"
        )

    return log