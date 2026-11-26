from models import PostStatusHistory


def record_post_status_change(
    db,
    post_id: int,
    to_status: str,
    changed_by: int | None,
    from_status: str | None = None,
    schedule_id: int | None = None,
    reason: str | None = None,
):
    """Append a status event to the audit trail; caller owns the transaction."""
    db.add(PostStatusHistory(
        post_id=post_id,
        schedule_id=schedule_id,
        from_status=from_status,
        to_status=to_status,
        changed_by=changed_by,
        reason=reason,
    ))
