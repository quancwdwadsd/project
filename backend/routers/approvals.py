"""Quy trình duyệt nội dung (T0427C8).

POST /approvals/{post_id}/submit   Nhân viên gửi duyệt (Nháp/Từ chối → Chờ duyệt)
POST /approvals/{post_id}/approve  Người quản lý duyệt (Chờ duyệt → Đã duyệt)
POST /approvals/{post_id}/reject   Người quản lý từ chối, bắt buộc có lý do (Chờ duyệt → Từ chối)
GET  /approvals/pending            Danh sách bài chờ duyệt (người quản lý)
GET  /approvals/mine               Bài do chính mình tạo, kèm trạng thái và lý do từ chối
GET  /approvals/me                 Thông tin người đăng nhập và quyền duyệt (giao diện dùng để ẩn/hiện nút)

Quyền được kiểm tra ở máy chủ, không chỉ ẩn nút trên giao diện.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import approval_rules as rules
from database import get_db
from models import ActivityLog, Post, Role, User
from schemas import PostResponse
from security import get_current_user

router = APIRouter(
    prefix="/approvals",
    tags=["Approvals"]
)


class RejectRequest(BaseModel):
    reason: str = ""


class ApprovalPost(PostResponse):
    """Bài viết kèm tên người tạo/duyệt và nhãn trạng thái tiếng Việt để giao diện hiển thị."""
    status_label: str
    creator_name: str | None = None
    approver_name: str | None = None


class ApprovalMe(BaseModel):
    id: int
    username: str
    role: str
    can_review: bool


def get_role_name(user: User, db: Session) -> str:
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return role.role_name if role else ""


def require_reviewer(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Chỉ Người quản lý (hoặc Quản trị viên) đi tiếp được; vai trò khác nhận 403."""
    if not rules.is_reviewer(get_role_name(user, db)):
        raise HTTPException(
            status_code=403,
            detail="Chỉ Người quản lý mới được duyệt hoặc từ chối nội dung"
        )
    return user


def find_post(post_id: int, db: Session) -> Post:
    # with_for_update: khóa dòng để hai người duyệt cùng lúc không ghi đè nhau
    post = db.query(Post).filter(Post.id == post_id).with_for_update().first()
    if not post:
        raise HTTPException(status_code=404, detail="Không tìm thấy bài viết")
    return post


def log_action(db: Session, user: User, request: Request, action: str):
    """Ghi nhật ký (ai, làm gì, lúc nào) cùng giao dịch với thay đổi trạng thái."""
    db.add(ActivityLog(
        user_id=user.id,
        action=action[:255],
        ip_address=request.client.host if request.client else None
    ))


def to_response(posts: list[Post], db: Session) -> list[dict]:
    user_ids = {p.created_by for p in posts} | {p.approved_by for p in posts if p.approved_by}
    names = {}
    if user_ids:
        names = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    return [
        {
            **PostResponse.model_validate(p).model_dump(),
            "status_label": rules.label(p.status),
            "creator_name": names.get(p.created_by),
            "approver_name": names.get(p.approved_by),
        }
        for p in posts
    ]


@router.get("/me", response_model=ApprovalMe)
def get_me(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    role_name = get_role_name(user, db)
    return {
        "id": user.id,
        "username": user.username,
        "role": role_name,
        "can_review": rules.is_reviewer(role_name)
    }


@router.get("/pending", response_model=list[ApprovalPost])
def list_pending(
    reviewer: User = Depends(require_reviewer),
    db: Session = Depends(get_db)
):
    posts = db.query(Post).filter(Post.status == rules.PENDING).order_by(Post.updated_at.asc(), Post.id.asc()).all()
    return to_response(posts, db)


@router.get("/mine", response_model=list[ApprovalPost])
def list_mine(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    posts = db.query(Post).filter(Post.created_by == user.id).order_by(Post.id.desc()).all()
    return to_response(posts, db)


@router.post("/{post_id}/submit", response_model=ApprovalPost)
def submit_for_review(
    post_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    post = find_post(post_id, db)

    error = rules.check_submit(post.status, post.created_by, user.id)
    if error:
        db.rollback()
        raise HTTPException(status_code=409 if post.created_by == user.id else 403, detail=error)

    # Bài gửi lại sau khi bị từ chối: xóa lý do và người duyệt cũ
    resubmit = post.status == rules.REJECTED
    post.status = rules.PENDING
    post.reject_reason = None
    post.approved_by = None

    log_action(db, user, request, f"Gửi duyệt{' lại' if resubmit else ''} bài viết #{post.id}: {post.title}")
    db.commit()
    db.refresh(post)
    return to_response([post], db)[0]


@router.post("/{post_id}/approve", response_model=ApprovalPost)
def approve_post(
    post_id: int,
    request: Request,
    reviewer: User = Depends(require_reviewer),
    db: Session = Depends(get_db)
):
    post = find_post(post_id, db)

    error = rules.check_review(post.status, post.created_by, reviewer.id)
    if error:
        db.rollback()
        raise HTTPException(status_code=403 if post.created_by == reviewer.id else 409, detail=error)

    post.status = rules.APPROVED
    post.approved_by = reviewer.id
    post.reject_reason = None

    log_action(db, reviewer, request, f"Duyệt bài viết #{post.id}: {post.title}")
    db.commit()
    db.refresh(post)
    return to_response([post], db)[0]


@router.post("/{post_id}/reject", response_model=ApprovalPost)
def reject_post(
    post_id: int,
    data: RejectRequest,
    request: Request,
    reviewer: User = Depends(require_reviewer),
    db: Session = Depends(get_db)
):
    # Kiểm tra lý do trước: thiếu lý do thì trạng thái không đổi
    error = rules.check_reject_reason(data.reason)
    if error:
        raise HTTPException(status_code=422, detail=error)

    post = find_post(post_id, db)

    error = rules.check_review(post.status, post.created_by, reviewer.id)
    if error:
        db.rollback()
        raise HTTPException(status_code=403 if post.created_by == reviewer.id else 409, detail=error)

    reason = rules.clean_reason(data.reason)
    post.status = rules.REJECTED
    post.reject_reason = reason
    post.approved_by = None

    log_action(db, reviewer, request, f"Từ chối bài viết #{post.id}: {reason}")
    db.commit()
    db.refresh(post)
    return to_response([post], db)[0]
