from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ActivityLog, Role, User
from schemas import ActivityLogResponse
from security import get_current_user
from approval_rules import is_reviewer

router = APIRouter(
    prefix="/activity-logs",
    tags=["Activity Logs"]
)

def require_log_viewer(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Admin hoặc Quản lý xem được nhật ký (không phân biệt hoa thường, nhận cả 'Quản lý')."""
    role = db.query(Role).filter(Role.id == current_user.role_id).first()
    if not role or not is_reviewer(role.role_name):
        raise HTTPException(status_code=403, detail="You do not have permission")
    return current_user

@router.get("/", response_model=list[ActivityLogResponse])
def get_activity_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_log_viewer)
):
    logs = db.query(ActivityLog).order_by(
        ActivityLog.created_at.desc()
    ).all()

    return logs


@router.get("/{log_id}", response_model=ActivityLogResponse)
def get_activity_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_log_viewer)
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