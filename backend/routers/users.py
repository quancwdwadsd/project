from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
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

router = APIRouter(
    prefix="/users",
    tags=["Users"]
)


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

    password_hash = bcrypt.hashpw(
        user_data.password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")

    new_user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=password_hash,
        role_id=user_data.role_id
    )

    db.add(new_user)
    db.commit()
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

    role = db.query(Role).filter(
        Role.id == role_data.role_id
    ).first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found"
        )

    user.role_id = role.id

    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role_id": user.role_id,
        "role_name": role.role_name,
        "status": user.status
    }


# PATCH /users/{user_id}/status
@router.patch("/{user_id}/status", response_model=UserResponse)
def update_user_status(
    user_id: int,
    status_data: UserStatusUpdate,
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

    user.status = status_data.status

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
