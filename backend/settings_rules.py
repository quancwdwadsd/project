"""Quy tắc cấu hình hệ thống (UC03). Không phụ thuộc thư viện ngoài để dễ kiểm thử.

Danh sách mục cấu hình khai báo một lần ở FIELDS, dùng cho kiểm tra giá trị,
so sánh thay đổi, cảnh báo tác động và ghi nhật ký.
Khớp với frontend/src/features/settings/services/settings-storage.js.
"""

TIMEZONES = {
    "Asia/Ho_Chi_Minh": "Việt Nam (UTC+7)",
    "Asia/Bangkok": "Bangkok (UTC+7)",
    "Asia/Singapore": "Singapore (UTC+8)",
    "Asia/Tokyo": "Tokyo (UTC+9)",
    "UTC": "UTC (UTC+0)",
}
DUPLICATE_MODES = {
    "warn": "Cảnh báo, vẫn cho lưu",
    "block": "Chặn, không cho lưu",
}

FIELDS = {
    "timezone": {"type": "select", "options": TIMEZONES, "default": "Asia/Ho_Chi_Minh", "label": "Múi giờ hiển thị"},
    "requireApproval": {"type": "boolean", "default": True, "label": "Bắt buộc duyệt trước khi lên lịch"},
    "manualPublishNeedsLink": {"type": "boolean", "default": True, "label": "Đăng thủ công cần đường dẫn bài gốc"},
    "duplicateSlot": {"type": "select", "options": DUPLICATE_MODES, "default": "warn", "label": "Khi lịch trùng giờ trên cùng kênh"},
    "retryLimit": {"type": "number", "min": 0, "max": 5, "unit": "lần", "default": 3, "label": "Số lần thử lại khi đăng tự động thất bại"},
    "overdueMinutes": {"type": "number", "min": 5, "max": 1440, "unit": "phút", "default": 60, "label": "Đánh dấu bài quá lịch sau"},
    "sessionMinutes": {"type": "number", "min": 5, "max": 480, "unit": "phút", "default": 30, "label": "Phiên đăng nhập hết hạn sau"},
    "maxFailedLogins": {"type": "number", "min": 3, "max": 10, "unit": "lần", "default": 5, "label": "Số lần nhập sai mật khẩu tối đa"},
    "lockMinutes": {"type": "number", "min": 1, "max": 1440, "unit": "phút", "default": 15, "label": "Thời gian khóa tạm"},
    "minPasswordLength": {"type": "number", "min": 8, "max": 32, "unit": "ký tự", "default": 8, "label": "Độ dài mật khẩu tối thiểu"},
    "syncIntervalHours": {"type": "number", "min": 1, "max": 24, "unit": "giờ", "default": 6, "label": "Chu kỳ cập nhật số liệu tự động"},
    "maxFileMb": {"type": "number", "min": 1, "max": 500, "unit": "MB", "default": 100, "label": "Dung lượng tệp tải lên tối đa"},
    "logRetentionMonths": {"type": "number", "min": 12, "max": 60, "unit": "tháng", "default": 12, "label": "Thời gian lưu nhật ký hoạt động"},
    "apiConnect": {"type": "boolean", "default": False, "label": "Cho phép kết nối kênh qua API"},
    "autoPost": {"type": "boolean", "default": False, "label": "Đăng bài tự động"},
    "autoSync": {"type": "boolean", "default": False, "label": "Đồng bộ chỉ số tương tác tự động"},
}

DEFAULTS = {key: field["default"] for key, field in FIELDS.items()}


def _is_int(value):
    # bool là lớp con của int trong Python nên phải loại ra
    return isinstance(value, int) and not isinstance(value, bool)


def validate(config):
    """Trả về {tên_mục: thông báo lỗi}. Rỗng nghĩa là hợp lệ."""
    errors = {}
    for key, field in FIELDS.items():
        value = config.get(key)
        kind = field["type"]
        if kind == "boolean":
            if not isinstance(value, bool):
                errors[key] = "Giá trị không hợp lệ."
        elif kind == "number":
            if not _is_int(value) or value < field["min"] or value > field["max"]:
                errors[key] = f"Nhập số nguyên từ {field['min']} đến {field['max']} {field['unit']}."
        elif not isinstance(value, str) or value not in field["options"]:
            errors[key] = "Chọn một giá trị có trong danh sách."
    for key, name in (("autoPost", "đăng tự động"), ("autoSync", "đồng bộ tự động")):
        if config.get(key) is True and config.get("apiConnect") is not True and key not in errors:
            errors[key] = f"Cần bật “Cho phép kết nối kênh qua API” trước khi bật {name}."
    return errors


def format_value(key, value):
    field = FIELDS[key]
    if field["type"] == "boolean":
        return "Bật" if value else "Tắt"
    if field["type"] == "select":
        return field["options"].get(value, str(value))
    return f"{value} {field['unit']}"


def diff(before, after):
    """Danh sách mục thay đổi giữa hai bản cấu hình."""
    return [
        {"key": key, "label": FIELDS[key]["label"], "before": format_value(key, before[key]), "after": format_value(key, after[key])}
        for key in FIELDS
        if before[key] != after[key]
    ]


def impacts(before, after):
    """Cảnh báo tác động trước khi lưu (UC03 – A2)."""
    out = []
    if before["timezone"] != after["timezone"]:
        out.append(f"Giờ hiển thị của lịch đăng, báo cáo và nhật ký chuyển sang {TIMEZONES[after['timezone']]}. Giờ lưu (UTC) không đổi.")
    if before["requireApproval"] != after["requireApproval"]:
        out.append("Từ nay nội dung phải được duyệt trước khi lên lịch. Nội dung nháp đang có cần gửi duyệt." if after["requireApproval"] else "Nội dung có thể lên lịch mà không cần duyệt.")
    if not before["autoPost"] and after["autoPost"]:
        out.append("Bài có lịch ở chế độ tự động sẽ được hệ thống đăng đúng giờ và không thu hồi được từ hệ thống.")
    if before["autoPost"] and not after["autoPost"]:
        out.append("Tắt đăng tự động: các lịch tự động đang chờ sẽ chuyển sang đăng thủ công.")
    if before["apiConnect"] and not after["apiConnect"]:
        out.append("Tắt kết nối API: các kênh đã kết nối ngừng đăng và đồng bộ tự động. Kênh vẫn quản lý thủ công được.")
    if before["autoSync"] and not after["autoSync"]:
        out.append("Tắt đồng bộ tự động: số liệu tương tác cần nhập thủ công.")
    return out


def serialize_value(value):
    """Giá trị -> chuỗi để lưu vào cột setting_value."""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def parse_value(key, raw):
    """Chuỗi trong DB -> giá trị đúng kiểu. Trả về None nếu dữ liệu hỏng."""
    kind = FIELDS[key]["type"]
    if kind == "boolean":
        return {"true": True, "false": False}.get(raw)
    if kind == "number":
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
    return raw if raw in FIELDS[key]["options"] else None
