from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import bcrypt

from database import get_db
from models import User, Role
from schemas import (
    UserCreate,
    UserUpdate,
    UserRoleUpdate,
    UserStatusUpdate,
    UserResponse
)
from schemas import UserAccessUpdate
from security import get_current_user, require_roles
from activity_logger import record_activity

router = APIRouter(
    prefix="/users",
    tags=["Users"],
    dependencies=[Depends(require_roles("Admin"))],
)


@router.get("/roles")
def get_roles(db: Session = Depends(get_db)):
    return [{"id": role.id, "name": role.role_name}
            for role in db.query(Role).order_by(Role.id).all()]


def access_change(db, user_id, role_id=None, status=None, delete=False, actor_id=None, ip_address=None):
    # Lock users in a consistent order so concurrent changes cannot remove both admins.
    users = db.query(User).order_by(User.id).populate_existing().with_for_update().all()
    user = next((item for item in users if item.id == user_id), None)
    if user is None:
        raise HTTPException(404, "User not found")
    roles = {role.id: role for role in db.query(Role).all()}
    target_role = roles.get(role_id if role_id is not None else user.role_id)
    if target_role is None:
        raise HTTPException(404, "Role not found")
    target_status = user.status if status is None else status
    old_role_name = roles[user.role_id].role_name if user.role_id in roles else str(user.role_id)
    old_status = user.status
    admin_ids = {role.id for role in roles.values() if role.role_name.lower() == "admin"}
    if (user.role_id in admin_ids and user.status
            and (delete or target_role.id not in admin_ids or not target_status)
            and not any(item.id != user.id and item.role_id in admin_ids and item.status for item in users)):
        raise HTTPException(409, "Cần giữ ít nhất một quản trị viên đang hoạt động.")
    if delete:
        if actor_id is not None:
            record_activity(db, actor_id, f"Thu hồi quyền và xóa người dùng {user.username}", ip_address)
        db.delete(user)
    else:
        user.role_id = target_role.id
        user.status = target_status
        if actor_id is not None and (old_role_name != target_role.role_name or old_status != target_status):
            changes = []
            if old_role_name != target_role.role_name:
                changes.append(f"vai trò {old_role_name} → {target_role.role_name}")
            if old_status != target_status:
                old_label = "hoạt động" if old_status else "đã khóa"
                new_label = "hoạt động" if target_status else "đã khóa"
                changes.append(f"trạng thái {old_label} → {new_label}")
            record_activity(db, actor_id, f"Đổi quyền người dùng {user.username}: " + "; ".join(changes), ip_address)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Không thể xóa người dùng đang có dữ liệu liên quan.")
    if delete:
        return None
    db.refresh(user)
    return {"id": user.id, "username": user.username, "email": user.email,
            "role_id": user.role_id, "role_name": target_role.role_name, "status": user.status}


@router.patch("/{user_id}/access", response_model=UserResponse)
def update_user_access(user_id: int, data: UserAccessUpdate, request: Request, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    return access_change(db, user_id, data.role_id, data.status, actor_id=actor.id, ip_address=request.client.host if request.client else None)


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    access_change(db, user_id, delete=True, actor_id=actor.id, ip_address=request.client.host if request.client else None)


# GET /users/
@router.get("/", response_model=list[UserResponse])
def get_users(db: Session = Depends(get_db)):
    users = db.query(User, Role.role_name).join(
        Role,
        User.role_id == Role.id
    ).all()

    return [
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role_id": user.role_id,
            "role_name": role_name,
            "status": user.status
        }
        for user, role_name in users
    ]


# GET /users/{user_id}
@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db)):
    result = db.query(User, Role.role_name).join(
        Role,
        User.role_id == Role.id
    ).filter(User.id == user_id).first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    user, role_name = result

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role_id": user.role_id,
        "role_name": role_name,
        "status": user.status
    }


# POST /users/
@router.post("/", response_model=UserResponse, status_code=201)
def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db)
):
    existing_user = db.query(User).filter(
        (User.username == user_data.username) |
        (User.email == user_data.email)
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username or email already exists"
        )

    role = db.query(Role).filter(
        Role.id == user_data.role_id
    ).first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found"
        )

    if len(user_data.password.encode("utf-8")) > 72:
        raise HTTPException(422, "Mật khẩu không được vượt quá 72 byte.")
    password_hash = bcrypt.hashpw(
        user_data.password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")

    new_user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=password_hash,
        role_id=user_data.role_id,
        status=user_data.status
    )

    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Username or email already exists")
    db.refresh(new_user)

    return {
        "id": new_user.id,
        "username": new_user.username,
        "email": new_user.email,
        "role_id": new_user.role_id,
        "role_name": role.role_name,
        "status": new_user.status
    }


# PUT /users/{user_id}
@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(
        User.id == user_id
    ).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    existing_user = db.query(User).filter(
        ((User.username == user_data.username) |
         (User.email == user_data.email)) &
        (User.id != user_id)
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username or email already exists"
        )

    user.username = user_data.username
    user.email = user_data.email

    db.commit()
    db.refresh(user)

    role = db.query(Role).filter(
        Role.id == user.role_id
    ).first()

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role_id": user.role_id,
        "role_name": role.role_name,
        "status": user.status
    }


# PATCH /users/{user_id}/role
@router.patch("/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: int,
    role_data: UserRoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user)
):
    return access_change(db, user_id, role_id=role_data.role_id, actor_id=actor.id, ip_address=request.client.host if request.client else None)


# PATCH /users/{user_id}/status
@router.patch("/{user_id}/status", response_model=UserResponse)
def update_user_status(
    user_id: int,
    status_data: UserStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user)
):
    return access_change(db, user_id, status=status_data.status, actor_id=actor.id, ip_address=request.client.host if request.client else None)
