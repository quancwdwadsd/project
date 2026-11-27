from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import PostMetric, Post, User
from schemas import PostMetricCreate, PostMetricResponse
from security import get_current_user, require_roles


router = APIRouter(
    prefix="/metrics",
    tags=["Post Metrics"]
)


@router.get("/", response_model=list[PostMetricResponse])
def get_metrics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(PostMetric).join(Post, Post.id == PostMetric.post_id).filter(
        Post.deleted_at.is_(None)
    ).order_by(PostMetric.collected_at.desc()).all()


@router.get("/post/{post_id}", response_model=list[PostMetricResponse])
def get_post_metrics(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(Post).filter(
        Post.id == post_id,
        Post.deleted_at.is_(None)
    ).first()

    if not post:
        raise HTTPException(
            status_code=404,
            detail="Post not found"
        )

    return db.query(PostMetric).filter(
        PostMetric.post_id == post_id
    ).order_by(PostMetric.collected_at.desc()).all()


@router.post("/", response_model=PostMetricResponse)
def create_metric(
    metric_data: PostMetricCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    post = db.query(Post).filter(
        Post.id == metric_data.post_id,
        Post.deleted_at.is_(None)
    ).first()

    if not post:
        raise HTTPException(
            status_code=404,
            detail="Post not found"
        )

    metric = PostMetric(
        post_id=metric_data.post_id,
        likes=metric_data.likes,
        comments=metric_data.comments,
        shares=metric_data.shares,
        views=metric_data.views,
        source=metric_data.source
    )

    db.add(metric)
    db.commit()
    db.refresh(metric)

    return metric
