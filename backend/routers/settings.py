from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

import settings_rules as rules
from database import get_db
from models import Role, User
from models_settings import SystemSetting
from security import get_current_user
from schemas_settings import (
    SettingHistoryItem,
    SettingsMe,
    SettingsResponse,
    SettingsUpdate,
    SettingsUpdateResponse,
)

router = APIRouter(
    prefix="/settings",
    tags=["Settings"]
)

ADMIN_ROLE_NAME = "admin"
LOG_PREFIX = "Đổi cấu hình"

# auto_error=False để thiếu token luôn trả 401 "Chưa đăng nhập" (không phụ thuộc phiên bản FastAPI).
bearer_scheme = HTTPBearer(auto_error=False)


def get_logged_in_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db)
):
    """Người đang đăng nhập, lấy từ JWT (đăng nhập bằng POST /auth/login).

    Gửi kèm header: Authorization: Bearer <access_token>
    """
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Chưa đăng nhập"
        )

    # Kiểm tra chữ ký, hạn dùng của token và tài khoản có còn hoạt động hay không (401 nếu sai).
    return get_current_user(credentials, db)


def get_role_name(user: User, db: Session) -> str:
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return role.role_name if role else ""


def get_current_admin(
    user: User = Depends(get_logged_in_user),
    db: Session = Depends(get_db)
):
    """Chỉ Quản trị viên đi tiếp được (403 nếu là vai trò khác)."""
    if get_role_name(user, db).strip().lower() != ADMIN_ROLE_NAME:
        raise HTTPException(
            status_code=403,
            detail="Chỉ Quản trị viên được xem và thay đổi cấu hình hệ thống"
        )

    return user


def load_values(db: Session):
    """Cấu hình hiện tại: giá trị trong DB, mục nào thiếu hoặc hỏng thì lấy mặc định."""
    values = dict(rules.DEFAULTS)

    for row in db.query(SystemSetting).all():
        if row.setting_key not in rules.FIELDS:
            continue

        parsed = rules.parse_value(row.setting_key, row.setting_value)

        if parsed is not None:
            values[row.setting_key] = parsed

    return values


# GET /settings/me : giao diện dùng để hiện tên, vai trò và biết người này có được cấu hình không
@router.get("/me", response_model=SettingsMe)
def get_settings_me(
    user: User = Depends(get_logged_in_user),
    db: Session = Depends(get_db)
):
    role_name = get_role_name(user, db)

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": role_name,
        "can_configure": role_name.strip().lower() == ADMIN_ROLE_NAME
    }


# GET /settings : chỉ Quản trị viên được xem
@router.get("/", response_model=SettingsResponse)
def get_settings(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    return {"values": load_values(db)}


# PUT /settings
@router.put("/", response_model=SettingsUpdateResponse)
def update_settings(
    data: SettingsUpdate,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    current = load_values(db)

    unknown = {
        key: "Mục cấu hình không tồn tại."
        for key in data.changes
        if key not in rules.FIELDS
    }

    if unknown:
        raise HTTPException(
            status_code=422,
            detail={"message": "Có mục cấu hình không tồn tại", "errors": unknown}
        )

    new_values = {**current, **data.changes}
    errors = rules.validate(new_values)

    # A1: giá trị sai thì không lưu gì, giữ nguyên cấu hình cũ
    if errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Cấu hình không hợp lệ, cấu hình cũ được giữ nguyên",
                "errors": errors
            }
        )

    changes = rules.diff(current, new_values)

    if not changes:
        return {"values": current, "changes": []}

    # A2: thay đổi có ảnh hưởng thì phải xác nhận trước khi lưu
    warnings = rules.impacts(current, new_values)

    if warnings and not data.confirm_impact:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Thay đổi này có ảnh hưởng, cần xác nhận (confirm_impact = true)",
                "impacts": warnings
            }
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)  # lưu UTC
    ip_address = request.client.host if request.client else None

    try:
        for change in changes:
            key = change["key"]
            row = db.query(SystemSetting).filter(
                SystemSetting.setting_key == key
            ).first()

            if row:
                row.setting_value = rules.serialize_value(new_values[key])
                row.updated_by = admin.id
                row.updated_at = now
            else:
                db.add(SystemSetting(
                    setting_key=key,
                    setting_value=rules.serialize_value(new_values[key]),
                    updated_by=admin.id,
                    updated_at=now
                ))

            # Ghi nhật ký: ai đổi, lúc nào, đổi gì (bảng activity_logs trong ERD)
            action = f"{LOG_PREFIX} {change['label']}: {change['before']} → {change['after']}"
            db.execute(
                text(
                    "INSERT INTO activity_logs (user_id, action, ip_address, created_at) "
                    "VALUES (:user_id, :action, :ip_address, :created_at)"
                ),
                {
                    "user_id": admin.id,
                    "action": action[:255],
                    "ip_address": ip_address,
                    "created_at": now
                }
            )

        db.commit()

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Không lưu được cấu hình, cấu hình cũ được giữ nguyên"
        )

    return {"values": new_values, "changes": changes}


# GET /settings/history
@router.get("/history", response_model=list[SettingHistoryItem])
def get_settings_history(
    limit: int = Query(default=50, ge=1, le=200),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    rows = db.execute(
        text(
            "SELECT l.id, l.user_id, u.username, l.action, l.created_at "
            "FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id "
            "WHERE l.action LIKE :prefix "
            "ORDER BY l.id DESC LIMIT :limit"
        ),
        {"prefix": f"{LOG_PREFIX}%", "limit": limit}
    ).mappings().all()

    return [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "username": row["username"],
            "action": row["action"],
            "created_at": row["created_at"].isoformat() + "Z"
        }
        for row in rows
    ]
