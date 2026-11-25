from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import or_
from sqlalchemy.orm import Session

import approval_rules as rules
from activity_logger import record_activity
from database import get_db
from models import ActivityLog, Post, Role, User
from schemas_approvals import (
    ApprovalDetail,
    ApprovalItem,
    ApprovalListResponse,
    ApprovalMe,
    RejectRequest,
)
from security import get_current_user


router = APIRouter(
    prefix="/approvals",
    tags=["Approvals"]
)

LOG_NOUN = "nội dung #"
LOG_SUBMIT = "Gửi duyệt nội dung #"
LOG_APPROVE = "Duyệt nội dung #"
LOG_REJECT = "Từ chối nội dung #"
PREVIEW_LENGTH = 160

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class Actor:
    user: User
    role_name: str


def get_logged_in_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db)
):
    if credentials is None:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")

    return get_current_user(credentials, db)


def get_role_name(user: User, db: Session) -> str:
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return role.role_name if role else ""


def get_actor(
    user: User = Depends(get_logged_in_user),
    db: Session = Depends(get_db)
):
    role_name = get_role_name(user, db)

    if not rules.can_access(role_name):
        raise HTTPException(
            status_code=403,
            detail="Vai trò của bạn không có quyền dùng chức năng duyệt nội dung"
        )

    return Actor(user=user, role_name=role_name)


def iso(value):
    return value.isoformat() + "Z" if value else None


def load_names(db: Session, user_ids):
    ids = sorted({uid for uid in user_ids if uid is not None})

    if not ids:
        return {}

    return {user.id: user.username for user in db.query(User).filter(User.id.in_(ids)).all()}


def to_item(post: Post, names: dict, actor: Actor) -> dict:
    status = post.status or rules.DRAFT
    content = post.content or ""

    return {
        "id": post.id,
        "title": post.title,
        "preview": content[:PREVIEW_LENGTH],
        "campaign_tag": post.campaign_tag,
        "status": status,
        "reject_reason": post.reject_reason,
        "author_id": post.created_by,
        "author_name": names.get(post.created_by),
        "approver_id": post.approved_by,
        "approver_name": names.get(post.approved_by),
        "created_at": iso(post.created_at),
        "updated_at": iso(post.updated_at),
        "can_submit": status in rules.SUBMITTABLE_FROM
        and rules.can_submit(actor.role_name, actor.user.id, post.created_by),
        "can_review": status in rules.REVIEWABLE_FROM and rules.is_reviewer(actor.role_name),
    }


def item_response(db: Session, post: Post, actor: Actor) -> dict:
    return to_item(post, load_names(db, [post.created_by, post.approved_by]), actor)


def get_visible_post(db: Session, post_id: int, actor: Actor) -> Post:
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post or not (rules.is_reviewer(actor.role_name) or post.created_by == actor.user.id):
        raise HTTPException(status_code=404, detail="Không tìm thấy nội dung")

    return post


def escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def load_history(db: Session, post_id: int):
    rows = (
        db.query(ActivityLog)
        .filter(or_(
            ActivityLog.action.like(f"%{LOG_NOUN}{post_id}"),
            ActivityLog.action.like(f"%{LOG_NOUN}{post_id}:%")
        ))
        .order_by(ActivityLog.id.desc())
        .limit(50)
        .all()
    )
    names = load_names(db, [row.user_id for row in rows])
    history = []

    for row in rows:
        if row.action.startswith(LOG_SUBMIT):
            event = "submit"
        elif row.action.startswith(LOG_APPROVE):
            event = "approve"
        elif row.action.startswith(LOG_REJECT):
            event = "reject"
        else:
            continue

        _, _, note = row.action.partition(": ")

        history.append({
            "event": event,
            "action": row.action,
            "note": note or None,
            "user_id": row.user_id,
            "username": names.get(row.user_id),
            "created_at": iso(row.created_at)
        })

    return history


def change_status(db: Session, post: Post, allowed_from, values: dict, actor: Actor, log_text: str, request: Request):
    try:
        changed = (
            db.query(Post)
            .filter(Post.id == post.id, Post.status.in_(list(allowed_from)))
            .update(values, synchronize_session=False)
        )

        if not changed:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="Trạng thái nội dung vừa được người khác thay đổi. Vui lòng tải lại danh sách."
            )

        record_activity(
            db,
            actor.user.id,
            log_text,
            request.client.host if request.client else None
        )
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Không lưu được thay đổi. Trạng thái nội dung được giữ nguyên."
        )

    db.refresh(post)


@router.get("/me", response_model=ApprovalMe)
def get_me(
    user: User = Depends(get_logged_in_user),
    db: Session = Depends(get_db)
):
    role_name = get_role_name(user, db)

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": role_name,
        "can_use": rules.can_access(role_name),
        "can_review": rules.is_reviewer(role_name)
    }


@router.get("/", response_model=ApprovalListResponse)
def list_approvals(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db)
):
    if status is not None and status not in rules.STATUSES:
        raise HTTPException(status_code=422, detail="Trạng thái lọc không hợp lệ")

    visible = []

    if not rules.is_reviewer(actor.role_name):
        visible.append(Post.created_by == actor.user.id)

    counts = dict.fromkeys(rules.STATUSES, 0)

    for (post_status,) in db.query(Post.status).filter(*visible).all():
        key = post_status or rules.DRAFT

        if key in counts:
            counts[key] += 1

    query = db.query(Post).filter(*visible)

    if status:
        query = query.filter(Post.status == status)

    if q and q.strip():
        query = query.filter(Post.title.ilike(f"%{escape_like(q.strip())}%", escape="\\"))

    total = query.count()
    posts = query.order_by(Post.updated_at.desc(), Post.id.desc()).offset(offset).limit(limit).all()
    names = load_names(db, [uid for post in posts for uid in (post.created_by, post.approved_by)])

    return {
        "items": [to_item(post, names, actor) for post in posts],
        "counts": counts,
        "total": total
    }


@router.get("/{post_id}", response_model=ApprovalDetail)
def get_approval(
    post_id: int,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db)
):
    post = get_visible_post(db, post_id, actor)
    detail = item_response(db, post, actor)
    detail["content"] = post.content or ""
    detail["history"] = load_history(db, post.id)

    return detail


@router.post("/{post_id}/submit", response_model=ApprovalItem)
def submit_for_review(
    post_id: int,
    request: Request,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db)
):
    post = get_visible_post(db, post_id, actor)

    if not rules.can_submit(actor.role_name, actor.user.id, post.created_by):
        raise HTTPException(
            status_code=403,
            detail="Chỉ người tạo nội dung (hoặc Quản trị viên) mới gửi duyệt được"
        )

    if (post.status or rules.DRAFT) not in rules.SUBMITTABLE_FROM:
        raise HTTPException(status_code=409, detail=rules.state_message("submit", post.status))

    errors = rules.submit_errors(post.title, post.content)

    if errors:
        raise HTTPException(
            status_code=422,
            detail={"message": "Nội dung chưa đủ để gửi duyệt", "errors": errors}
        )

    change_status(
        db, post, rules.SUBMITTABLE_FROM,
        {"status": rules.PENDING, "reject_reason": None, "approved_by": None},
        actor, f"{LOG_SUBMIT}{post.id}: {post.title.strip()[:80]}", request
    )

    return item_response(db, post, actor)


@router.post("/{post_id}/approve", response_model=ApprovalItem)
def approve_post(
    post_id: int,
    request: Request,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db)
):
    if not rules.is_reviewer(actor.role_name):
        raise HTTPException(status_code=403, detail="Chỉ Người quản lý hoặc Quản trị viên mới duyệt được")

    post = get_visible_post(db, post_id, actor)

    if post.status not in rules.REVIEWABLE_FROM:
        raise HTTPException(status_code=409, detail=rules.state_message("approve", post.status))

    change_status(
        db, post, rules.REVIEWABLE_FROM,
        {"status": rules.APPROVED, "approved_by": actor.user.id, "reject_reason": None},
        actor, f"{LOG_APPROVE}{post.id}", request
    )

    return item_response(db, post, actor)


@router.post("/{post_id}/reject", response_model=ApprovalItem)
def reject_post(
    post_id: int,
    data: RejectRequest,
    request: Request,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db)
):
    if not rules.is_reviewer(actor.role_name):
        raise HTTPException(status_code=403, detail="Chỉ Người quản lý hoặc Quản trị viên mới từ chối được")

    post = get_visible_post(db, post_id, actor)

    if post.status not in rules.REVIEWABLE_FROM:
        raise HTTPException(status_code=409, detail=rules.state_message("reject", post.status))

    reason, error = rules.clean_reason(data.reason)

    if error:
        raise HTTPException(
            status_code=422,
            detail={"message": error, "errors": {"reason": error}}
        )

    change_status(
        db, post, rules.REVIEWABLE_FROM,
        {"status": rules.REJECTED, "approved_by": None, "reject_reason": reason},
        actor, f"{LOG_REJECT}{post.id}: {reason}", request
    )

    return item_response(db, post, actor)
