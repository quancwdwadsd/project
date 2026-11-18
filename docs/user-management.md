# Trang quản lý người dùng

Trang dùng HTML, CSS và JavaScript thuần, gọi FastAPI để đọc/ghi MySQL. Chạy từ thư mục gốc dự án:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m uvicorn main:app --app-dir backend --reload
```

Điền `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` và `JWT_SECRET_KEY` trong `backend/.env`; database phải có các bảng và vai trò hiện có. Không tự tạo hoặc đổi schema khi mở trang.

Ở terminal khác, chạy `python -m http.server 5500 --directory frontend` rồi mở `http://127.0.0.1:5500/src/app/index.html`, hoặc dùng Live Server. Backend cho phép CORS từ localhost/127.0.0.1. Thay meta `api-base-url` trong `index.html` nếu backend chạy ở địa chỉ khác. Không mở bằng `file://`.

## Cấu trúc

- `frontend/src/app/index.html`: bố cục trang, biểu tượng SVG nội bộ và biểu mẫu.
- `frontend/src/styles/style.css`: biến màu, layout, sidebar, header và responsive dùng chung.
- `frontend/src/features/users/users.css`: danh sách thành viên, menu thao tác và hộp thoại.
- `frontend/src/features/users/users.js`: tìm kiếm, biểu mẫu, thêm/sửa/khóa/xóa và xử lý giao diện.
- `frontend/src/features/users/services/users-storage.js`: gọi API, lấy vai trò thật và chuyển dữ liệu backend sang dạng giao diện.

## Thao tác

- Tìm kiếm bằng tên, email hoặc vai trò; hỗ trợ nhập tên không dấu. Có thể dùng `Ctrl+K` hoặc `Cmd+K` để đến ô tìm kiếm.
- Chọn **Thêm người dùng** để nhập thông tin. Email phải hợp lệ và chưa được sử dụng.
- Form thêm người dùng có tên đăng nhập (3–50 ký tự), email, mật khẩu (tối thiểu 8 ký tự, tối đa 72 byte), vai trò và trạng thái. Tên hiển thị dùng `username` theo schema hiện có; không có cột họ tên riêng.
- Chọn dấu ba chấm trên từng dòng để sửa, khóa/mở khóa hoặc xóa người dùng. Form chỉnh sửa riêng chỉ cho đổi vai trò và trạng thái; họ tên và email được giữ nguyên. Xóa cần xác nhận.
- Không cho khóa, xóa hoặc hạ quyền quản trị viên đang hoạt động cuối cùng.
- Danh sách lấy từ database; dữ liệu localStorage cũ không được đọc hoặc tự nhập vào database. Không có dữ liệu mẫu dự phòng khi API lỗi.
- Backend lưu trạng thái boolean: hoạt động/đã khóa. Không có trạng thái chờ xác minh trong schema hiện tại.
- Chỉ cập nhật giao diện sau khi API thành công. Khi lỗi, giữ form và báo lỗi để thử lại. Khóa nút lưu trong khi request đang chạy.
- Vai trò và trạng thái được lưu cùng transaction qua `PATCH /users/{id}/access`; API này từ chối trường khác như tên/email. API cũ `/role`, `/status` cũng bảo vệ quản trị viên cuối cùng. Xóa có thể bị từ chối nếu người dùng có dữ liệu liên quan.

## Phạm vi

Thêm, sửa vai trò/trạng thái, khóa/mở khóa và xóa đều gọi API ghi database. Không gửi thư mời. Các mục điều hướng khác giữ nguyên phạm vi hiện tại.

Router người dùng hiện có chưa áp dụng xác thực/phân quyền; tích hợp phiên đăng nhập và kiểm tra quyền Admin ở server là bước riêng cần hoàn thiện trước khi đưa lên môi trường dùng chung.

Kiểm thử API với database SQLite cô lập, không ghi MySQL thật:

```powershell
backend/.venv/Scripts/python.exe -B -m unittest discover -s backend/tests -v
```
