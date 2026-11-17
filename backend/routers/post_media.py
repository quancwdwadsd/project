from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import PostMedia, Post, Media, User
from schemas import PostMediaCreate, PostMediaResponse
from security import get_current_user, require_roles


router = APIRouter(
    prefix="/posts",
    tags=["Post Media"]
)


@router.get("/{post_id}/media", response_model=list[PostMediaResponse])
def get_post_media(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(Post).filter(
        Post.id == post_id
    ).first()

    if not post:
        raise HTTPException(
            status_code=404,
            detail="Post not found"
        )

    return db.query(PostMedia).filter(
        PostMedia.post_id == post_id
    ).all()


@router.post("/{post_id}/media", response_model=PostMediaResponse)
def add_media_to_post(
    post_id: int,
    media_data: PostMediaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(Post).filter(
        Post.id == post_id
    ).first()

    if not post:
        raise HTTPException(
            status_code=404,
            detail="Post not found"
        )

    if post.created_by != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Permission denied"
        )

    media = db.query(Media).filter(
        Media.id == media_data.media_id
    ).first()

    if not media:
        raise HTTPException(
            status_code=404,
            detail="Media not found"
        )

    existing = db.query(PostMedia).filter(
        PostMedia.post_id == post_id,
        PostMedia.media_id == media_data.media_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Media already added to this post"
        )

    post_media = PostMedia(
        post_id=post_id,
        media_id=media_data.media_id
    )

    db.add(post_media)
    db.commit()
    db.refresh(post_media)

    return post_media


@router.delete("/{post_id}/media/{media_id}")
def remove_media_from_post(
    post_id: int,
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(Post).filter(
        Post.id == post_id
    ).first()

    if not post:
        raise HTTPException(
            status_code=404,
            detail="Post not found"
        )

    if post.created_by != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Permission denied"
        )

    post_media = db.query(PostMedia).filter(
        PostMedia.post_id == post_id,
        PostMedia.media_id == media_id
    ).first()

    if not post_media:
        raise HTTPException(
            status_code=404,
            detail="Media association not found"
        )

    db.delete(post_media)
    db.commit()

    return {
        "message": "Media removed from post successfully"
    }