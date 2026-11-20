"""Quy tắc duyệt nội dung (T0427C8 – Quy trình duyệt nội dung). Không phụ thuộc thư viện ngoài để dễ kiểm thử.

Luồng:  Nháp (draft) → Chờ duyệt (pending) → Đã duyệt (approved) | Từ chối (rejected)
        Từ chối (rejected) → gửi duyệt lại → Chờ duyệt (pending)
        Nội dung đã duyệt bị chỉnh sửa → quay về Nháp, phải gửi duyệt lại (xem reopen_after_edit).

Giá trị trạng thái giữ nguyên tiếng Anh như cột posts.status đang dùng; nhãn tiếng Việt chỉ để hiển thị.
"""

DRAFT = "draft"
PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"

LABELS = {
    DRAFT: "Nháp",
    PENDING: "Chờ duyệt",
    APPROVED: "Đã duyệt",
    REJECTED: "Từ chối",
    "published": "Đã đăng",
}

# Trạng thái cho phép gửi duyệt (nháp, hoặc bị từ chối và đã chỉnh sửa)
SUBMITTABLE = {DRAFT, REJECTED}

# Vai trò được duyệt/từ chối. So sánh không phân biệt hoa thường; chấp nhận cả tên tiếng Việt trong từ điển dữ liệu.
REVIEWER_ROLES = {"admin", "manager", "quản lý"}

MAX_REASON_LENGTH = 1000


def is_reviewer(role_name):
    return (role_name or "").strip().lower() in REVIEWER_ROLES


def label(status):
    return LABELS.get(status, status or "")


def check_submit(status, post_owner_id, user_id):
    """Trả về thông báo lỗi (str) nếu không được gửi duyệt, ngược lại None."""
    if post_owner_id != user_id:
        return "Chỉ người tạo bài viết mới được gửi duyệt."
    if status == PENDING:
        return "Bài viết đang chờ duyệt."
    if status == APPROVED:
        return "Bài viết đã được duyệt."
    if status not in SUBMITTABLE:
        return f"Không thể gửi duyệt bài viết ở trạng thái “{label(status)}”."
    return None


def clean_reason(reason):
    """Lý do từ chối đã bỏ khoảng trắng thừa; rỗng nghĩa là chưa nhập."""
    return (reason or "").strip()


def check_review(status, post_owner_id, reviewer_id):
    """Điều kiện chung để duyệt hoặc từ chối. Trả về thông báo lỗi hoặc None."""
    if status != PENDING:
        return f"Chỉ duyệt được bài viết ở trạng thái “{label(PENDING)}”, bài này đang “{label(status)}”."
    if post_owner_id == reviewer_id:
        return "Bạn không được tự duyệt hoặc từ chối nội dung do chính mình tạo."
    return None


def check_reject_reason(reason):
    cleaned = clean_reason(reason)
    if not cleaned:
        return "Phải nhập lý do khi từ chối bài viết."
    if len(cleaned) > MAX_REASON_LENGTH:
        return f"Lý do tối đa {MAX_REASON_LENGTH} ký tự."
    return None


def reopen_after_edit(status):
    """Trạng thái mới sau khi nội dung bị chỉnh sửa. Bài đã duyệt hoặc đang chờ duyệt phải duyệt lại → về Nháp."""
    if status in (APPROVED, PENDING):
        return DRAFT
    return status
