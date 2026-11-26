# API cấu hình hệ thống (UC03 – T0427C5)

Backend FastAPI + SQLAlchemy + MySQL (TiDB Cloud). Trang `settings.html` đọc và ghi cấu hình **qua API này**; dữ liệu nằm ở database của nhóm, không lưu trong trình duyệt.

## Chuẩn bị

1. Chạy `backend/sql/system_settings.sql` trên database của nhóm (TiDB Cloud → SQL Editor) để tạo bảng `system_settings` và nạp giá trị mặc định. Kiểm tra: `SELECT * FROM system_settings;` phải ra 16 dòng.
2. Bảng `roles` phải có vai trò `Admin` và có ít nhất một tài khoản Admin đang hoạt động (mật khẩu băm bcrypt, đăng nhập được bằng `POST /auth/login`).
3. `backend/main.py` đã đăng ký `routers/settings.py` (2 dòng `settings_router`).
4. Chạy backend (trong thư mục `backend`): `uvicorn main:app --reload`. Mở giao diện bằng Live Server rồi vào `frontend/src/app/settings.html`.
5. Backend không chạy ở `http://127.0.0.1:8000` thì khai báo `window.MEDIAHUB_API_BASE` trước khi nạp `settings-api.js`.

## Các API

Tất cả cần `Authorization: Bearer <token>` (lấy từ `POST /auth/login`).

| Method | Đường dẫn | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/settings/me` | đã đăng nhập | Người đang đăng nhập: `id`, `username`, `email`, `role`, `can_configure`. Giao diện dùng để hiện tên, logo và biết có được cấu hình không |
| GET | `/settings/` | **Admin** | Cấu hình hiện tại (mục chưa có thì lấy mặc định) |
| PUT | `/settings/` | **Admin** | Đổi cấu hình. Chỉ gửi các mục muốn đổi |
| GET | `/settings/history` | **Admin** | Lịch sử đổi cấu hình: ai đổi, lúc nào, đổi gì. Mới nhất trước |

Gọi đúng có dấu `/` ở cuối (`/settings/`), nếu không FastAPI chuyển hướng 307.

### PUT /settings/

```json
{ "changes": { "timezone": "Asia/Singapore", "sessionMinutes": 45 }, "confirm_impact": false }
```

- **200**: đã lưu. Trả về `values` (cấu hình mới) và `changes` (mục đã đổi, giá trị trước và sau).
- **422**: giá trị không hợp lệ hoặc mục không tồn tại. **Không lưu gì**, cấu hình cũ giữ nguyên. Chi tiết ở `detail.errors`.
- **409**: thay đổi có ảnh hưởng (đổi múi giờ, bật/tắt duyệt, bật/tắt tích hợp...). Tác động ở `detail.impacts`. Người dùng đồng ý thì gửi lại với `"confirm_impact": true`.
- **401**: chưa đăng nhập, token hết hạn hoặc tài khoản bị khóa. **403**: không phải Admin.
- **500**: lỗi database, đã rollback, cấu hình cũ giữ nguyên.

## Lưu người cập nhật

Mỗi lần lưu, với từng mục đổi:

- Bảng `system_settings`: cột `updated_by` (id người lưu) và `updated_at` (UTC).
- Bảng `activity_logs`: một dòng gồm `user_id`, `action` (ví dụ `Đổi cấu hình Múi giờ hiển thị: Việt Nam (UTC+7) → Singapore (UTC+8)`), `ip_address`, `created_at`.

`GET /settings/history` nối `activity_logs` với `users` để trả tên người đổi (`username`). Các dòng cùng một lần lưu có cùng `created_at`, giao diện gộp thành một mục.

## Các mục cấu hình

Danh sách, khoảng giá trị và mặc định nằm ở `backend/settings_rules.py` (biến `FIELDS`), khớp với `frontend/src/features/settings/services/settings-storage.js`. `autoPost` và `autoSync` chỉ bật được khi `apiConnect` đang bật. Sửa luật ở một nơi thì phải sửa nơi còn lại.

## Kiểm thử

- Luật kiểm tra (không cần database): `cd backend && python -m unittest discover -s tests -p "test_settings_rules.py" -v`
- Thử API đang chạy: đặt `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `USER_LOGIN`, `USER_PASSWORD` (một tài khoản Admin, một tài khoản không phải Admin) rồi chạy `python check_settings.py`.
- Thử trọn luồng: đăng nhập Admin trên `settings.html`, đổi một giá trị, Lưu, rồi trên database chạy `SELECT * FROM system_settings;` và `SELECT * FROM activity_logs ORDER BY id DESC LIMIT 5;` để thấy dữ liệu và người lưu.

## Lưu ý

- Khung đăng nhập trên trang cấu hình là **tạm thời**. Trang Đăng nhập chung chỉ cần lưu `access_token` vào `localStorage` với khóa `mediahub.token` là trang cấu hình dùng được ngay.
- Bảng `system_settings` chưa có trong ERD và từ điển dữ liệu, cần bổ sung.


## Tích hợp đăng nhập chung (UC01)

Trang cấu hình hệ thống sử dụng phiên đăng nhập chung do `MediaHubAuth` tạo (`mediahub.session.v1`). Không có form đăng nhập/token riêng trong trang cấu hình. Nếu phiên không tồn tại hoặc hết hạn, trang chuyển về `login.html`.
