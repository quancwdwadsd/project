# Trang cấu hình hệ thống (UC03 – T0427C5)

Mở `frontend/src/app/settings.html` trực tiếp bằng trình duyệt hoặc dùng Live Server trong VS Code. Trang dùng HTML, CSS và JavaScript thuần, cùng kiểu với trang quản lý người dùng; không cần cài thư viện hay build.

## Cấu trúc

- `frontend/src/app/settings.html`: bố cục trang, thanh điều hướng, biểu mẫu và hộp thoại xác nhận.
- `frontend/src/features/settings/settings.css`: thẻ cấu hình, nút bật/tắt, thanh thao tác, lịch sử và hộp thoại.
- `frontend/src/features/settings/settings.js`: dựng biểu mẫu, hiển thị lỗi từng trường, xác nhận tác động, lưu và hiển thị lịch sử.
- `frontend/src/features/settings/services/settings-storage.js`: danh sách mục cấu hình (nhãn, khoảng giá trị, mặc định), kiểm tra giá trị, so sánh thay đổi, định dạng thời gian.
- `frontend/src/features/settings/services/settings-api.js`: gọi backend (đăng nhập, lấy người dùng, đọc/lưu cấu hình, lịch sử) bằng token JWT.

## Các nhóm cấu hình

- **Múi giờ**: mặc định giờ Việt Nam (UTC+7). Thời gian lưu dạng UTC, hiển thị theo múi giờ đã chọn.
- **Quy tắc trạng thái bài đăng**: bắt buộc duyệt trước khi lên lịch, đăng thủ công cần đường dẫn bài gốc, xử lý lịch trùng giờ, số lần thử lại, thời gian đánh dấu quá lịch.
- **Thông số vận hành**: thời gian hết phiên, số lần nhập sai và thời gian khóa tạm, độ dài mật khẩu tối thiểu, chu kỳ cập nhật số liệu, dung lượng tệp tối đa, thời gian lưu nhật ký.
- **Tích hợp mạng xã hội**: kết nối API, đăng tự động, đồng bộ chỉ số tự động. Đăng tự động và đồng bộ chỉ số cần bật kết nối API.

## Quy tắc

- Giá trị không hợp lệ: báo lỗi ngay tại trường, **không lưu gì** và giữ nguyên cấu hình đang áp dụng.
- Thay đổi có ảnh hưởng (đổi múi giờ, đổi quy tắc duyệt, bật/tắt tích hợp): hiện hộp thoại liệt kê tác động và chỉ lưu khi người dùng xác nhận.
- Mỗi lần lưu ghi một mục lịch sử: ai đổi, lúc nào, đổi gì (giá trị cũ → giá trị mới). Giữ tối đa 100 mục mới nhất.
- Chỉ vai trò Quản trị viên được xem và sửa. Người dùng khác đăng nhập chỉ thấy tên, logo và thông báo "Chỉ Quản trị viên được xem và thay đổi cấu hình hệ thống.". Backend kiểm tra quyền thật (403).
- Sau khi đăng nhập, header hiện logo (chữ cái đầu) và tên người dùng, vai trò. Dòng "Cập nhật lần cuối bởi ... lúc ..." cho biết ai lưu gần nhất.
- Không có trường nhập khóa bí mật hay token.
- Cấu hình và lịch sử lưu ở **database** qua API (`docs/system-settings-api.md`), không lưu trong trình duyệt. Trình duyệt chỉ giữ token đăng nhập (`localStorage`, khóa `mediahub.token`).
- Người lưu được ghi ở database: cột `updated_by`, `updated_at` của bảng `system_settings` và bảng `activity_logs`.

## Phạm vi

Khung đăng nhập trên trang cấu hình là tạm thời, dùng khi trang Đăng nhập chung của nhóm chưa lưu token. Trang đăng nhập chung chỉ cần lưu `access_token` từ `POST /auth/login` vào `localStorage` với khóa `mediahub.token` thì trang cấu hình tự dùng được. Việc ẩn trang với người không phải Admin chỉ để giao diện gọn; quyền thật do backend kiểm tra.
