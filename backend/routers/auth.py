import re
import unicodedata
from uuid import uuid4
from pathlib import Path

from fastapi import UploadFile, File

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import Role, User
from schemas import AuthUserResponse, Token, UserLogin, UserRegister
from security import (
    create_access_token,
    get_access_token_expire_minutes,
    get_current_user,
)


router = APIRouter(prefix="/auth", tags=["Authentication"])


def user_response(user: User, role: Role):
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name or user.username,
        "email": user.email,
        "role_id": user.role_id,
        "role_name": role.role_name,
        "avatar_url": user.avatar_url,
    }


def make_username(full_name: str):
    normalized = unicodedata.normalize("NFKD", full_name)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii").lower()
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")[:40] or "member"
    return f"{base}-{uuid4().hex[:8]}"


@router.post("/register", response_model=AuthUserResponse, status_code=201)
def register(user_data: UserRegister, db: Session = Depends(get_db)):
    full_name = user_data.full_name.strip()
    email = str(user_data.email).strip().lower()
    password = user_data.password.encode("utf-8")

    if len(full_name) < 2:
        raise HTTPException(422, "Họ tên cần ít nhất 2 ký tự.")
    if len(password) > 72:
        raise HTTPException(422, "Mật khẩu không được vượt quá 72 byte.")

    existing_user = db.query(User).filter(
        func.lower(User.email) == email
    ).first()
    if existing_user:
        raise HTTPException(409, "Email này đã được sử dụng.")

    role = db.query(Role).filter(
        func.lower(Role.role_name) == "employee"
    ).first()
    if not role:
        raise HTTPException(500, "Database chưa có vai trò employee.")

    user = User(
        username=make_username(full_name),
        full_name=full_name,
        email=email,
        password_hash=bcrypt.hashpw(password, bcrypt.gensalt()).decode("utf-8"),
        role_id=role.id,
        status=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Không thể tạo tài khoản với thông tin này.")
    db.refresh(user)

    return user_response(user, role)


@router.post("/login", response_model=Token)
def login(user_data: UserLogin, db: Session = Depends(get_db)):
    identity = user_data.username_or_email.strip()
    password = user_data.password.encode("utf-8")
    result = db.query(User, Role).outerjoin(Role, Role.id == User.role_id).filter(
        or_(
            User.username == identity,
            func.lower(User.email) == identity.lower(),
        )
    ).first()
    user, role = result if result else (None, None)

    if not user or len(password) > 72 or not bcrypt.checkpw(
        password, user.password_hash.encode("utf-8")
    ):
        raise HTTPException(401, "Email hoặc mật khẩu không chính xác.")
    if not user.status:
        raise HTTPException(403, "Tài khoản đã bị khóa.")

    if not role:
        raise HTTPException(403, "Tài khoản chưa được gán vai trò.")

    session_minutes = get_access_token_expire_minutes(db)
    return {
        "access_token": create_access_token(user.id, session_minutes),
        "token_type": "bearer",
        "expires_in": session_minutes * 60,
        "user": user_response(user, role),
    }


@router.get("/me", response_model=AuthUserResponse)
def get_my_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.id == current_user.role_id).first()
    if not role:
        raise HTTPException(403, "Tài khoản chưa được gán vai trò.")
    return user_response(current_user, role)


@router.put("/me/avatar", response_model=AuthUserResponse)
async def update_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    extension = allowed.get(file.content_type or "")
    if not extension:
        raise HTTPException(415, "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WEBP.")
    payload = await file.read(5 * 1024 * 1024 + 1)
    if not payload or len(payload) > 5 * 1024 * 1024:
        raise HTTPException(413, "Ảnh đại diện phải nhỏ hơn 5 MB.")
    signatures = {"image/jpeg": payload.startswith(b"\xff\xd8\xff"), "image/png": payload.startswith(b"\x89PNG\r\n\x1a\n"), "image/webp": payload.startswith(b"RIFF") and payload[8:12] == b"WEBP"}
    if not signatures[file.content_type]:
        raise HTTPException(415, "Định dạng ảnh không hợp lệ.")
    upload_dir = Path(__file__).resolve().parents[1] / "uploads" / "avatars"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}{extension}"
    avatar_file = upload_dir / filename
    avatar_file.write_bytes(payload)
    previous = current_user.avatar_url
    current_user.avatar_url = f"/uploads/avatars/{filename}"
    try:
        db.commit()
    except Exception:
        db.rollback()
        avatar_file.unlink(missing_ok=True)
        raise
    db.refresh(current_user)
    if previous and previous.startswith("/uploads/avatars/"):
        old_name = Path(previous).name
        old_file = upload_dir / old_name
        if old_file.is_file():
            old_file.unlink()
    role = db.query(Role).filter(Role.id == current_user.role_id).first()
    if not role:
        raise HTTPException(403, "Tài khoản chưa được gán vai trò.")
    return user_response(current_user, role)
