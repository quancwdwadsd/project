# Quy trình duyệt nội dung (T0427C8)

Trang: `frontend/src/app/approvals.html`. Backend: `backend/routers/approvals.py`, luật ở `backend/approval_rules.py`. **Không có bảng mới** — dùng cột `posts.status`, `posts.reject_reason`, `posts.approved_by` và ghi `activity_logs` theo ERD hiện có.

## Luồng trạng thái

`draft` (Nháp) → `pending` (Chờ duyệt) → `approved` (Đã duyệt) hoặc `rejected` (Từ chối) → nhân viên sửa và gửi duyệt lại → `pending`.

| Method | Đường dẫn | Ai được gọi | Việc làm |
| --- | --- | --- | --- |
| POST | `/approvals/{id}/submit` | Người tạo bài | draft/rejected → pending; xóa lý do từ chối cũ |
| POST | `/approvals/{id}/approve` | Admin/Manager, không phải người tạo | pending → approved, ghi `approved_by` |
| POST | `/approvals/{id}/reject` | Admin/Manager, không phải người tạo | pending → rejected, **bắt buộc** `{"reason": "..."}` |
| GET | `/approvals/pending` | Admin/Manager | Bài chờ duyệt |
| GET | `/approvals/mine` | Đã đăng nhập | Bài do mình tạo (kèm lý do từ chối) |
| GET | `/approvals/me` | Đã đăng nhập | Tên, vai trò, `can_review` |

Mã lỗi: 401 chưa đăng nhập · 403 sai quyền hoặc tự duyệt bài của mình · 404 không có bài · 409 sai trạng thái (vd. duyệt bài đang là nháp) · 422 thiếu lý do từ chối. Mỗi thao tác ghi một dòng vào `activity_logs` (ai, làm gì, lúc nào, IP) trong cùng giao dịch với việc đổi trạng thái.

## Việc còn lại ngoài phạm vi task (cần người phụ trách UC06 thêm vào `routers/posts.py`)

1. **Sửa nội dung đã duyệt phải duyệt lại.** Trong `update_post`, sau vòng `setattr`, thêm:
   ```python
   import approval_rules
   post.status = approval_rules.reopen_after_edit(post.status)
   if post.status == "draft":
       post.approved_by = None
   ```
2. **`PATCH /posts/{id}/status` đang cho Manager đặt thẳng `approved`**, bỏ qua kiểm tra “không tự duyệt” và “phải qua Chờ duyệt”. Nên bỏ giá trị `approved`/`rejected` khỏi endpoint này (đã có `/approvals/...`) hoặc gọi `approval_rules.check_review`.
3. **Lên lịch (UC08)** chỉ nên nhận bài `approved` khi cấu hình `requireApproval` đang bật.

## Chạy kiểm thử

- Luật (không cần database): `cd backend && python -m unittest discover -s tests -p "test_approval_rules.py" -v`
- API (SQLite tạm, cần `pip install -r requirements.txt`): `python -m unittest discover -s tests -p "test_approvals_api.py" -v`
- API đang chạy thật (24 kiểm tra): đặt `STAFF_LOGIN`, `STAFF_PASSWORD`, `MANAGER_LOGIN`, `MANAGER_PASSWORD` rồi chạy `python check_approvals.py` ở thư mục gốc. Script tự tạo bài thử và xóa lại.
- Giao diện: chạy `uvicorn main:app --reload` trong `backend`, mở `approvals.html` bằng Live Server, đăng nhập tài khoản Nhân viên → Gửi duyệt; đăng nhập Quản lý → Duyệt/Từ chối.
