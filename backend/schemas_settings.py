from typing import Any

from pydantic import BaseModel


class SettingsUpdate(BaseModel):
    # Chỉ gửi các mục muốn đổi, ví dụ {"timezone": "Asia/Singapore"}
    changes: dict[str, Any]
    # Đặt True sau khi người dùng đã xem cảnh báo tác động
    confirm_impact: bool = False


class SettingChange(BaseModel):
    key: str
    label: str
    before: str
    after: str


class SettingsResponse(BaseModel):
    values: dict[str, Any]


class SettingsUpdateResponse(BaseModel):
    values: dict[str, Any]
    changes: list[SettingChange]


class SettingHistoryItem(BaseModel):
    id: int
    user_id: int | None
    username: str | None
    action: str
    created_at: str


class SettingsMe(BaseModel):
    id: int
    username: str
    email: str
    role: str
    can_configure: bool
