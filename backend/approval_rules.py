DRAFT, PENDING, APPROVED, REJECTED, PUBLISHED = "draft", "pending", "approved", "rejected", "published"
STATUSES = (DRAFT, PENDING, APPROVED, REJECTED, PUBLISHED)

STATUS_LABELS = {
    DRAFT: "Nháp",
    PENDING: "Chờ duyệt",
    APPROVED: "Đã duyệt",
    REJECTED: "Bị từ chối",
    PUBLISHED: "Đã đăng",
}

SUBMITTABLE_FROM = (DRAFT, REJECTED)
REVIEWABLE_FROM = (PENDING,)

REVIEW_ROLES = ("admin", "manager")
READ_ONLY_ROLES = ("viewer",)

TITLE_MAX = 200
REASON_MIN, REASON_MAX = 5, 200


def role_key(role_name):
    return (role_name or "").strip().lower()


def is_reviewer(role_name):
    return role_key(role_name) in REVIEW_ROLES


def can_access(role_name):
    key = role_key(role_name)
    return bool(key) and key not in READ_ONLY_ROLES


def can_submit(role_name, user_id, author_id):
    if not can_access(role_name):
        return False
    return user_id == author_id or role_key(role_name) == "admin"


def submit_errors(title, content):
    errors = {}
    if not (title or "").strip():
        errors["title"] = "Nội dung chưa có tiêu đề."
    elif len(title.strip()) > TITLE_MAX:
        errors["title"] = f"Tiêu đề tối đa {TITLE_MAX} ký tự."
    if not (content or "").strip():
        errors["content"] = "Nội dung chưa có phần văn bản."
    return errors


def clean_reason(reason):
    text = " ".join((reason or "").split())
    if len(text) < REASON_MIN:
        return text, f"Vui lòng nhập lý do từ chối (ít nhất {REASON_MIN} ký tự) để người tạo biết cần sửa gì."
    if len(text) > REASON_MAX:
        return text, f"Lý do từ chối tối đa {REASON_MAX} ký tự."
    return text, None


def state_message(action, status):
    label = STATUS_LABELS.get(status, status or "không rõ")
    if action == "submit":
        if status == PENDING:
            return "Nội dung đã được gửi duyệt và đang chờ Người quản lý xử lý."
        return f"Nội dung đang ở trạng thái \"{label}\", không thể gửi duyệt."
    verb = "duyệt" if action == "approve" else "từ chối"
    if status == DRAFT:
        return f"Nội dung chưa được gửi duyệt nên chưa thể {verb}."
    if status in (APPROVED, REJECTED):
        return f"Nội dung đã được xử lý (\"{label}\"), không thể {verb} lại."
    return f"Nội dung đang ở trạng thái \"{label}\", không thể {verb}."
