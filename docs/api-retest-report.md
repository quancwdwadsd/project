# Kiểm thử lại sau thay đổi phân quyền UC02 — 18/11/2026

**Chưa hết toàn bộ lỗi.** Nhóm F01 đã được khắc phục; 12 ca lỗi thuộc 7 nhóm còn lại vẫn tái hiện được.

Chạy trên working tree hiện tại, bao gồm thay đổi chưa commit ở `backend/routers/users.py` và `backend/tests/test_users_api.py`. Chỉ chạy kiểm thử và ghi báo cáo, không sửa thêm code nghiệp vụ.

| Bộ test | Trước | Hiện tại |
| --- | --- | --- |
| `check_branch_api.py` — 155 ca | 140 đạt / 15 lỗi | **143 đạt / 12 lỗi** |
| `test_users_api.py` | 5/5 đạt, trước khi bổ sung kiểm tra quyền | **10/10 đạt**, gồm các kiểm tra quyền mới |

## Đối chiếu báo cáo cũ

| Mã | Tình trạng | Kết quả kiểm thử lại |
| --- | --- | --- |
| F01 — API người dùng công khai/tự nâng quyền | **Đã sửa: 3/3 ca trước đây lỗi nay đạt** | Không đăng nhập đọc danh sách: 401; không đăng nhập tạo Admin: 401; Editor tự nâng quyền: 403. |
| F02 — quyền task phụ thuộc ID vai trò | **Còn 3 ca lỗi** | Admin ID vai trò 10 và Manager ID 20 vẫn nhận 403; Viewer ID vai trò 1 vẫn đổi trạng thái task của người khác được 200. |
| F03 — mật khẩu đăng nhập trên 72 byte | **Còn 1 ca lỗi** | Đăng nhập với password 73 byte vẫn trả 500. |
| F04 — cập nhật null vào trường bắt buộc | **Còn 2 ca lỗi** | `PUT /posts/{id}` với `title: null` và `PUT /channels/{id}` với `channel_name: null` vẫn trả 500. |
| F05 — email cập nhật vượt giới hạn database | **Còn 1 ca lỗi** | `PUT /users/{id}` với email 109 ký tự vẫn được 200 trên SQLite, dù model khai báo giới hạn 100. |
| F06 — tiêu đề task rỗng | **Còn 1 ca lỗi** | `PUT /tasks/{id}` với `title: ""` vẫn được 200. |
| F07 — upload giả MIME ảnh | **Còn 1 ca lỗi** | HTML có phần mở rộng `.html`, khai báo `image/png`, vẫn được upload với 200. |
| F08 — xóa dữ liệu còn khóa ngoại | **Còn 3 ca lỗi** | Xóa media đang gắn bài, bài có lịch/metric, kênh có lịch vẫn trả 500. |

F02, F03, F04, F06, F07 và F08 nằm ngoài thay đổi phân quyền UC02 vừa thực hiện. F05 thuộc validation cập nhật người dùng, đã được giữ nguyên theo yêu cầu trước. Kết quả test không đồng nghĩa các lỗi này đã được cho phép sửa.

## Hồi quy UC02

10/10 test đạt, xác nhận:

- Admin được thay đổi vai trò và trạng thái qua endpoint tổng hợp lẫn endpoint riêng, tạo/xóa người dùng và cập nhật thông tin.
- Cả 9 endpoint UC02 chặn người chưa đăng nhập; Editor, Manager, Viewer nhận 403. Các request bị chặn không làm thay đổi dữ liệu người dùng.
- Token không hợp lệ, tài khoản khóa hoặc không tồn tại bị từ chối.
- Khóa, xóa hoặc hạ quyền Admin đang hoạt động cuối cùng vẫn bị chặn với 409, dữ liệu được giữ nguyên.
- Đổi quyền không thay đổi username/email/password hash; endpoint `/access` vẫn từ chối trường thông tin cá nhân không được phép.

## Điều kiện và giới hạn

Test dùng ứng dụng thật qua FastAPI TestClient, SQLite trong bộ nhớ có bật khóa ngoại và thư mục upload tạm; bộ mở rộng sử dụng đăng nhập/JWT hiện có. Không kết nối hoặc ghi MySQL thật.

Đã gửi request tới 50/51 endpoint OpenAPI; chưa chạy `GET /test-db` vì endpoint dùng câu lệnh MySQL. Đây là độ phủ endpoint, không phải toàn bộ nhánh code. Chưa kiểm thử frontend hoặc cạnh tranh transaction trên MySQL. F02 phụ thuộc ID vai trò thực tế; F05 và F08 cần xác nhận thêm với giới hạn độ dài/cascade của schema MySQL triển khai.

Cảnh báo trùng Operation ID của `GET /` và cảnh báo TestClient/httpx trong báo cáo cũ vẫn xuất hiện.

Lệnh chạy lại:

```powershell
backend/.venv/Scripts/python.exe -B -m unittest discover -s backend/tests -v
backend/.venv/Scripts/python.exe -B backend/tests/check_branch_api.py
```

Lệnh thứ hai trả exit code 1 vì vẫn còn 12 ca không đạt. Kết quả từng request đã được cập nhật trong `docs/api-test-results.json`. Báo cáo `docs/api-test-report.md` giữ nguyên làm mốc lịch sử trước sửa.


## Đồng bộ phiên đăng nhập UC01

Frontend cấu hình hệ thống và duyệt nội dung đọc access token từ `MediaHubAuth.getSession()` (session key `mediahub.session.v1`); không dùng token key cũ `mediahub.token`, không có form đăng nhập độc lập. Logout/401 kết thúc phiên chung và chuyển về trang đăng nhập UC01.
