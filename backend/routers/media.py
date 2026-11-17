import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from database import get_db
from models import Media, User
from schemas import MediaResponse
from security import get_current_user, require_roles


router = APIRouter(
    prefix="/media",
    tags=["Media"]
)


UPLOAD_DIR = "uploads"


os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.get("/", response_model=list[MediaResponse])
def get_media(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Media).order_by(Media.id.desc()).all()


@router.get("/{media_id}", response_model=MediaResponse)
def get_media_by_id(
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    media = db.query(Media).filter(
        Media.id == media_id
    ).first()

    if not media:
        raise HTTPException(
            status_code=404,
            detail="Media not found"
        )

    return media


@router.post("/upload", response_model=MediaResponse)
def upload_media(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    allowed_types = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4"
    ]

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="File type not supported"
        )

    max_size = 20 * 1024 * 1024
    file_content = file.file.read()

    if len(file_content) > max_size:
        raise HTTPException(
            status_code=400,
            detail="File size must not exceed 20MB"
        )

    extension = os.path.splitext(file.filename or "")[1].lower()

    if not extension:
        raise HTTPException(
            status_code=400,
            detail="File extension is required"
        )

    new_file_name = f"{uuid.uuid4().hex}{extension}"
    file_path = os.path.join(UPLOAD_DIR, new_file_name)

    with open(file_path, "wb") as uploaded_file:
        uploaded_file.write(file_content)

    media = Media(
        file_name=file.filename,
        file_path=file_path,
        file_type=file.content_type,
        uploaded_by=current_user.id
    )

    try:
        db.add(media)
        db.commit()
        db.refresh(media)
    except Exception:
        db.rollback()
        if os.path.exists(file_path):
            os.remove(file_path)
        raise

    return media


@router.delete("/{media_id}")
def delete_media(
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    media = db.query(Media).filter(
        Media.id == media_id
    ).first()

    if not media:
        raise HTTPException(
            status_code=404,
            detail="Media not found"
        )

    file_path = media.file_path

    db.delete(media)
    db.commit()

    if os.path.exists(file_path):
        os.remove(file_path)

    return {
        "message": "Media deleted successfully"
    }
