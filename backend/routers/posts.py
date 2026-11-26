from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from models import Post, PostStatusHistory, Role, User
from activity_logger import record_activity
from status_history import record_post_status_change
from schemas import PostCreate, PostUpdate, PostStatusUpdate, PostResponse
from security import get_current_user, require_roles


router = APIRouter(
    prefix="/posts",
    tags=["Posts"]
)


def can_manage_all_posts(db: Session, user: User):
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return bool(role and role.role_name.lower() in {"admin", "manager"})


@router.get("/", response_model=list[PostResponse])
def get_posts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    mine: bool = False,
):
    query = db.query(Post)
    if mine or not can_manage_all_posts(db, current_user):
        query = query.filter(Post.created_by == current_user.id)
    return query.order_by(Post.id.desc()).all()


@router.get("/{post_id}", response_model=PostResponse)
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.created_by != current_user.id and not can_manage_all_posts(db, current_user):
        raise HTTPException(status_code=403, detail="Permission denied")

    return post


@router.post("/", response_model=PostResponse)
def create_post(
    post_data: PostCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = Post(
        title=post_data.title,
        content=post_data.content,
        campaign_tag=post_data.campaign_tag,
        composer_data=post_data.composer_data,
        status="draft",
        created_by=current_user.id
    )

    db.add(post)
    db.flush()
    record_post_status_change(db, post.id, "draft", current_user.id, reason="Tạo bài viết")
    record_activity(db, current_user.id, f"Tạo bài #{post.id}: {post.title[:180]}", request.client.host if request.client else None)
    db.commit()
    db.refresh(post)

    return post


@router.put("/{post_id}", response_model=PostResponse)
def update_post(
    post_id: int,
    post_data: PostUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if post.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Permission denied")

    update_data = post_data.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(post, key, value)

    db.commit()
    db.refresh(post)

    return post


@router.delete("/{post_id}")
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if db.query(PostStatusHistory.id).filter(PostStatusHistory.post_id == post.id).first():
        raise HTTPException(status_code=409, detail="Bài đăng có lịch sử theo dõi và không thể xóa. Hãy hủy lịch đăng nếu cần.")
    if post.created_by != current_user.id and not can_manage_all_posts(db, current_user):
        raise HTTPException(status_code=403, detail="Permission denied")

    db.delete(post)
    db.commit()

    return {"message": "Post deleted successfully"}


@router.patch("/{post_id}/status", response_model=PostResponse)
def update_post_status(
    post_id: int,
    status_data: PostStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    allowed_statuses = ["draft", "pending", "approved", "rejected", "published"]

    if status_data.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Invalid post status")

    previous_status = post.status or "draft"
    post.status = status_data.status

    if status_data.status == "approved":
        post.approved_by = current_user.id
        post.reject_reason = None
    elif status_data.status == "rejected":
        post.reject_reason = status_data.reject_reason
    else:
        post.reject_reason = None

    if previous_status != post.status:
        reason = status_data.reject_reason if status_data.status == "rejected" else None
        record_post_status_change(
            db, post.id, post.status, current_user.id,
            from_status=previous_status, reason=reason
        )
        status_labels = {
            "draft": "Nháp", "pending": "Chờ duyệt", "approved": "Đã duyệt",
            "rejected": "Bị từ chối", "published": "Đã đăng",
        }
        record_activity(
            db, current_user.id,
            f"Cập nhật trạng thái nội dung #{post.id}: {status_labels.get(previous_status, previous_status)} → {status_labels.get(post.status, post.status)}",
            request.client.host if request.client else None
        )

    db.commit()
    db.refresh(post)

    return post
