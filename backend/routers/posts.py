from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Post, Role, Schedule, User
from activity_logger import record_activity
from status_history import record_post_status_change
from schemas import PostCreate, PostUpdate, PostStatusUpdate, PostResponse
from schemas_publishing import PublishPostRequest, PublishPostResponse, PublishChannelResult
from meta_publisher import MetaPublishError, publish_facebook, publish_instagram
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
    query = db.query(Post).filter(Post.deleted_at.is_(None))
    if mine or not can_manage_all_posts(db, current_user):
        query = query.filter(Post.created_by == current_user.id)
    return query.order_by(Post.id.desc()).all()


@router.get("/drafts/summary", response_model=list[PostDraftSummaryResponse])
def get_post_draft_summaries(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    mine: bool = True,
):
    query = db.query(
        Post.id, Post.title, Post.campaign_tag, Post.composer_data,
        Post.created_at, Post.updated_at,
    ).filter(Post.deleted_at.is_(None))
    if mine or not can_manage_all_posts(db, current_user):
        query = query.filter(Post.created_by == current_user.id)
    return [dict(row._mapping) for row in query.order_by(Post.id.desc()).all()]


@router.get("/{post_id}", response_model=PostResponse)
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(Post).filter(Post.id == post_id, Post.deleted_at.is_(None)).first()

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
    post = db.query(Post).filter(Post.id == post_id, Post.deleted_at.is_(None)).first()

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
    post = db.query(Post).filter(Post.id == post_id, Post.deleted_at.is_(None)).first()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if post.created_by != current_user.id and not can_manage_all_posts(db, current_user):
        raise HTTPException(status_code=403, detail="Permission denied")

    if (post.status or "draft") != "draft":
        raise HTTPException(status_code=409, detail="Chỉ có thể xóa bài nháp chưa gửi duyệt.")
    if db.query(Schedule.id).filter(Schedule.post_id == post.id).first():
        raise HTTPException(status_code=409, detail="Bài viết đã có lịch đăng nên không thể xóa.")

    post.deleted_at = func.current_timestamp()
    record_activity(db, current_user.id, f"Xóa bản nháp bài #{post.id}")
    db.commit()

    return {"message": "Draft deleted successfully"}


@router.post("/{post_id}/publish", response_model=PublishPostResponse)
async def publish_post(
    post_id: int,
    publish_data: PublishPostRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.created_by != current_user.id and not can_manage_all_posts(db, current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    if post.status != "approved":
        raise HTTPException(status_code=409, detail="Bài viết cần được duyệt trước khi đăng.")

    requested = list(dict.fromkeys(publish_data.channels))
    content = post.composer_data or {}
    if not isinstance(content, dict):
        content = {}
    selected = content.get("channels", [])
    selected = {str(channel).lower() for channel in selected} if isinstance(selected, list) else set()
    if not set(requested).issubset(selected):
        raise HTTPException(status_code=400, detail="Kênh đăng phải được chọn và lưu trong bài viết trước.")

    plain_text = post.content or ""
    results = []
    for channel in requested:
        try:
            if channel == "facebook":
                platform_id = await publish_facebook(plain_text)
            else:
                platform_id = await publish_instagram(plain_text, str(publish_data.image_url) if publish_data.image_url else None)
            results.append(PublishChannelResult(channel=channel, status="published", platform_post_id=platform_id or None))
        except MetaPublishError as error:
            results.append(PublishChannelResult(channel=channel, status="failed", error=str(error)))

    successful = [result for result in results if result.status == "published"]
    if successful and len(successful) == len(results):
        previous_status = post.status
        post.status = "published"
        record_post_status_change(db, post.id, "published", current_user.id, from_status=previous_status, reason="Đã đăng qua Meta API")
    for result in results:
        record_activity(
            db, current_user.id,
            f"Đăng bài #{post.id} lên {result.channel}: {result.status}"[:255],
            request.client.host if request.client else None,
        )
    db.commit()
    return PublishPostResponse(
        post_id=post.id,
        status="published" if successful and len(successful) == len(results) else "partial" if successful else "failed",
        results=results,
    )


@router.patch("/{post_id}/status", response_model=PostResponse)
def update_post_status(
    post_id: int,
    status_data: PostStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    post = db.query(Post).filter(Post.id == post_id, Post.deleted_at.is_(None)).first()

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
