import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
from models import User
from models_settings import SystemSetting
import settings_rules as settings


load_dotenv()

SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = settings.DEFAULTS["sessionMinutes"]

if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY is missing")

security = HTTPBearer()


def get_access_token_expire_minutes(db: Session) -> int:
    raw_value = db.query(SystemSetting.setting_value).filter(
        SystemSetting.setting_key == "sessionMinutes"
    ).scalar()
    minutes = settings.parse_value("sessionMinutes", raw_value)
    field = settings.FIELDS["sessionMinutes"]
    if not isinstance(minutes, int) or isinstance(minutes, bool) or not field["min"] <= minutes <= field["max"]:
        return ACCESS_TOKEN_EXPIRE_MINUTES
    return minutes


def create_access_token(user_id: int, expire_minutes: int | None = None):
    lifetime = expire_minutes if expire_minutes is not None else ACCESS_TOKEN_EXPIRE_MINUTES
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=lifetime
    )

    payload = {
        "sub": str(user_id),
        "exp": expire
    }

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        user_id = payload.get("sub")

        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )

    user = db.query(User).filter(
        User.id == int(user_id)
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    if not user.status:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    return user


def require_roles(*allowed_roles):
    def role_checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ):
        from models import Role

        role = db.query(Role).filter(
            Role.id == current_user.role_id
        ).first()

        allowed_names = {name.lower() for name in allowed_roles}
        if not role or role.role_name.lower() not in allowed_names:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission"
            )

        return current_user

    return role_checker
