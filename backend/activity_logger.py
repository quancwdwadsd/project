from sqlalchemy.orm import Session
from models import ActivityLog


def record_activity(
    db: Session,
    user_id: int,
    action: str,
    ip_address: str = None
):
    log = ActivityLog(
        user_id=user_id,
        action=action,
        ip_address=ip_address
    )

    db.add(log)