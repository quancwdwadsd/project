# Trang quản lý người dùng

Mở `frontend/src/app/index.html` trực tiếp bằng trình duyệt hoặc dùng Live Server trong VS Code. Trang dùng HTML, CSS và JavaScript thuần; không cần cài thư viện hay build.

## Cấu trúc

- `frontend/src/app/index.html`: bố cục trang, biểu tượng SVG nội bộ và biểu mẫu.
- `frontend/src/styles/style.css`: biến màu, layout, sidebar, header và responsive dùng chung.
- `frontend/src/features/users/users.css`: danh sách thành viên, menu thao tác và hộp thoại.
- `frontend/src/features/users/users.js`: tìm kiếm, biểu mẫu, thêm/sửa/khóa/xóa và xử lý giao diện.
- `frontend/src/features/users/services/users-storage.js`: dữ liệu mẫu, danh mục vai trò/trạng thái và lưu trữ trên trình duyệt.

## Thao tác

- Tìm kiếm bằng tên, email hoặc vai trò; hỗ trợ nhập tên không dấu. Có thể dùng `Ctrl+K` hoặc `Cmd+K` để đến ô tìm kiếm.
- Chọn **Thêm người dùng** để nhập thông tin. Email phải hợp lệ và chưa được sử dụng.
- Chọn dấu ba chấm trên từng dòng để sửa, khóa/mở khóa hoặc xóa người dùng. Xóa cần xác nhận.
- Không cho khóa, xóa hoặc hạ quyền quản trị viên đang hoạt động cuối cùng.
- Danh sách được lưu ở `localStorage` với khóa `mediahub.users.v1`. Nếu lưu trữ bị chặn, trang thông báo và giữ thay đổi trong bộ nhớ của lần mở hiện tại.
- Bốn thành viên ban đầu là dữ liệu mẫu theo ảnh tham khảo. Không lưu mật khẩu hoặc token.

## Phạm vi

Đây là giao diện frontend độc lập. Thêm người dùng chưa tạo tài khoản thật hay gửi thư mời; khóa tài khoản chỉ cập nhật dữ liệu trong trình duyệt. Các mục điều hướng khác hiển thị thông báo phạm vi thay vì chuyển đến trang chưa tồn tại.

Khi có backend, thay lớp lưu trữ bằng API thực tế và kiểm tra xác thực, phân quyền, giới hạn kênh và quy tắc quản trị ở server. Các kiểm tra frontend không phải cơ chế bảo mật.
