"""Nạp dữ liệu mẫu để thử quy trình duyệt nội dung (T0427C8) trên database trong backend/.env.

Chạy trong thư mục backend:
    python seed_approvals.py            # tạo 2 tài khoản thử + 6 bài viết mẫu
    python seed_approvals.py --clean    # xóa sạch dữ liệu mẫu đã tạo

Tài khoản tạo ra (mật khẩu in ra màn hình, mặc định Test@12345):
    test_staff    vai trò Nhân viên  -> tạo bài, gửi duyệt
    test_manager  vai trò Quản lý    -> duyệt / từ chối
Chạy lại nhiều lần không tạo trùng. Chỉ đụng vào tài khoản test_* và bài có tiêu đề bắt đầu bằng "[MẪU]".
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bcrypt  # noqa: E402

from database import SessionLocal  # noqa: E402
from models import ActivityLog, Post, PostMedia, Role, User  # noqa: E402

PASSWORD = os.environ.get("SEED_PASSWORD", "Test@12345")
PREFIX = "[MẪU] "
STAFF_NAMES = ["employee", "Nhân viên", "Editor"]
MANAGER_NAMES = ["admin", "manager", "Quản lý"]


def find_role(db, names):
    for role in db.query(Role).all():
        if role.role_name.strip().lower() in names:
            return role
    return None


def get_or_create_user(db, username, role):
    user = db.query(User).filter(User.username == username).first()
    if user:
        user.role_id = role.id  # đảm bảo đúng vai trò để thử
        user.status = True
        user.locked_until = None
        user.failed_login_attempts = 0
        return user
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash=bcrypt.hashpw(PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"),
        role_id=role.id,
        status=True,
    )
    db.add(user)
    db.flush()
    return user


def clean(db):
    users = db.query(User).filter(User.username.in_(["test_staff", "test_manager"])).all()
    user_ids = [u.id for u in users]
    posts = db.query(Post).filter(Post.title.like(f"{PREFIX}%")).all()
    post_ids = [p.id for p in posts]
    if post_ids:
        db.query(PostMedia).filter(PostMedia.post_id.in_(post_ids)).delete(synchronize_session=False)
    if user_ids:
        # bài của tài khoản thử mà không có tiền tố [MẪU] (vd. do check_approvals.py tạo dở) cũng xóa
        extra = db.query(Post).filter(Post.created_by.in_(user_ids)).all()
        extra_ids = [p.id for p in extra if p.id not in post_ids]
        if extra_ids:
            db.query(PostMedia).filter(PostMedia.post_id.in_(extra_ids)).delete(synchronize_session=False)
            db.query(Post).filter(Post.id.in_(extra_ids)).delete(synchronize_session=False)
    if post_ids:
        db.query(Post).filter(Post.id.in_(post_ids)).delete(synchronize_session=False)
    if user_ids:
        db.query(ActivityLog).filter(ActivityLog.user_id.in_(user_ids)).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
    db.commit()
    print(f"Đã xóa {len(post_ids)} bài mẫu và {len(user_ids)} tài khoản thử.")


def seed(db):
    staff_role = find_role(db, STAFF_NAMES)
    manager_role = find_role(db, MANAGER_NAMES)
    if not staff_role or not manager_role:
        names = ", ".join(r.role_name for r in db.query(Role).all()) or "(bảng roles trống)"
        raise SystemExit(
            "Không tìm thấy vai trò Nhân viên hoặc Quản lý trong bảng roles.\n"
            f"Các vai trò hiện có: {names}\n"
            "Thêm vai trò thiếu rồi chạy lại, hoặc sửa STAFF_NAMES / MANAGER_NAMES ở đầu file này."
        )

    staff = get_or_create_user(db, "test_staff", staff_role)
    manager = get_or_create_user(db, "test_manager", manager_role)

    if db.query(Post).filter(Post.title.like(f"{PREFIX}%")).count():
        db.commit()
        print("Bài mẫu đã có sẵn, không tạo thêm. Muốn làm lại từ đầu: python seed_approvals.py --clean")
    else:
        samples = [
            # (tiêu đề, nội dung, thẻ chiến dịch, trạng thái, người tạo, người duyệt, lý do từ chối)
            ("Bài nháp chưa gửi", "<p>Nội dung đang soạn dở, chưa gửi duyệt.</p>", None, "draft", staff, None, None),
            ("Khuyến mãi Noel 2026", "<p>Giảm <b>30%</b> toàn bộ sản phẩm từ 20/12 đến 25/12 🎄</p>", "noel-2026", "draft", staff, None, None),
            ("Ra mắt sản phẩm mới", "<p>Chúng tôi chính thức ra mắt dòng sản phẩm mới.</p>", "product-launch", "pending", staff, None, None),
            ("Thông báo lịch nghỉ Tết", "<p>Công ty nghỉ Tết từ 28/01 đến 05/02.</p>", None, "pending", staff, None, None),
            ("Bài viết sai chính tả", "<p>Noi dung co loi chinh ta can sua lai.</p>", "brand-awareness", "rejected", staff, None, "Sai chính tả ở tiêu đề và đoạn đầu, cần soát lại."),
            ("Chào mừng thành viên mới", "<p>Chào mừng bạn đến với cộng đồng của chúng tôi!</p>", "brand-awareness", "approved", staff, manager, None),
            ("Bài của quản lý chờ duyệt", "<p>Bài do quản lý tạo, dùng để thử chặn tự duyệt.</p>", None, "pending", manager, None, None),
        ]
        for title, content, tag, status, creator, approver, reason in samples:
            db.add(Post(
                title=PREFIX + title, content=content, campaign_tag=tag, status=status,
                created_by=creator.id, approved_by=approver.id if approver else None, reject_reason=reason,
            ))
        db.commit()
        print(f"Đã tạo {len(samples)} bài viết mẫu.")

    print("\nTài khoản để đăng nhập:")
    print(f"  test_staff    / {PASSWORD}   (vai trò: {staff_role.role_name})")
    print(f"  test_manager  / {PASSWORD}   (vai trò: {manager_role.role_name})")
    print("\nKỳ vọng trên trang Duyệt nội dung:")
    print("  test_staff   : Bài của tôi có 2 Nháp, 2 Chờ duyệt, 1 Từ chối (kèm lý do), 1 Đã duyệt")
    print("  test_manager : Chờ tôi duyệt có 3 bài; bài \"Bài của quản lý chờ duyệt\" không duyệt được (tự duyệt)")


if __name__ == "__main__":
    with SessionLocal() as session:
        if "--clean" in sys.argv:
            clean(session)
        else:
            seed(session)
