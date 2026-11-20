# Báo cáo kiểm thử API — 18/11/2026

Nhánh: `feature/UC2-quan-ly-nguoi-dung-va-phan-quyen`, HEAD `b7437d6`.

Kết luận: các luồng CRUD chính hoạt động trong môi trường kiểm thử, nhưng còn lỗi phân quyền nghiêm trọng và các trường hợp trả HTTP 500. Cần sửa trước khi đưa backend lên môi trường dùng chung.

## Phạm vi và môi trường

- So sánh lịch sử nhánh với `master` cục bộ. Commit mới nhất chủ yếu sửa API người dùng; báo cáo còn kiểm tra các router backend đã có trong lịch sử nhánh. Không khẳng định mọi lỗi dưới đây được tạo bởi commit mới nhất.
- Chạy ứng dụng thật `main.app` bằng FastAPI TestClient, qua HTTP trong tiến trình; dùng đăng nhập và JWT thật. Chỉ thay dependency `get_db` bằng SQLite trong bộ nhớ, bật `PRAGMA foreign_keys=ON`.
- Dữ liệu và upload được tạo riêng cho kiểm thử, tự dọn sau khi chạy. Không kết nối hoặc ghi dữ liệu MySQL cấu hình trong `.env`.
- Giữ nguyên hai thay đổi staged có sẵn ở `backend/.env` và `backend/database.py`. Không sửa code nghiệp vụ để làm test đạt.
- Python trong `backend/.venv`; FastAPI 0.163.1, Starlette 1.10.0, Pydantic 2.14.3, SQLAlchemy 2.1.9, bcrypt 5.0.0, httpx 0.28.1.
- Fixture vai trò: Admin ID 10, Manager ID 20, Editor ID 30, Viewer ID 1. Cố ý dùng ID khác 1/2 để kiểm tra quyền có phụ thuộc sai vào khóa chính hay không; đây không phải khẳng định ID của database thật.

## Kết quả

| Bộ kiểm tra | Tổng ca | Đạt | Không đạt |
| --- | ---: | ---: | ---: |
| Bộ có sẵn `backend/tests/test_users_api.py` | 5 | 5 | 0 |
| Bộ mở rộng `backend/tests/check_branch_api.py` | 155 | 140 | 15 |

Bộ mở rộng đã gửi request tới **50/51 cặp method + đường dẫn trong OpenAPI**. Bao gồm toàn bộ endpoint nghiệp vụ của 11 nhóm router: auth, users, posts, channels, schedules, tasks, media, post-media, interactions, metrics, activity-logs; ngoài ra có trang gốc và CORS preflight. Chỉ bỏ qua `GET /test-db` vì endpoint này chạy câu lệnh riêng của MySQL. Độ phủ này có nghĩa mỗi endpoint đã nhận ít nhất một request, không phải độ phủ mọi nhánh code hoặc mọi điều kiện nghiệp vụ.

Các nhóm đã đạt gồm đăng nhập bằng username/email; từ chối sai mật khẩu, tài khoản khóa, JWT sai/hết hạn/thiếu subject hoặc tài khoản không tồn tại; CRUD cơ bản; từ chối sửa bài của người khác; quyền tạo/duyệt theo vai trò; bảo vệ Admin cuối cùng qua bốn đường sửa/xóa; rollback khi đổi sang vai trò không tồn tại; từ chối dữ liệu bắt buộc bị thiếu, ID liên quan không tồn tại, trạng thái sai, số metric âm; chặn lịch bài chưa duyệt/kênh khóa; upload sai MIME khai báo hoặc trên 20 MiB; CORS localhost.

## Các lỗi tái hiện được

15 ca không đạt được gom thành 8 nhóm. Các mã 400/409/422 kỳ vọng dưới đây là tiêu chí xử lý đầu vào/xung đột của bộ test; API có thể chọn mã 4xx phù hợp khác khi sửa, nhưng không nên trả 500 hoặc cho phép thao tác trái quyền.

| Mã | Ưu tiên | Endpoint / tình huống | Kết quả thực tế | Số ca lỗi |
| --- | --- | --- | --- | ---: |
| F01 | Khẩn cấp | `/users/` và `/users/{id}/role` thiếu bảo vệ quyền | Chưa đăng nhập đọc danh sách được 200, tạo Admin được 201; Editor tự nâng quyền được 200 | 3 |
| F02 | Cao | `PATCH /tasks/{id}/status` kiểm tra cứng `role_id in [1, 2]` | Admin ID 10 / Manager ID 20 bị 403; Viewer ID 1 đổi task người khác được 200 | 3 |
| F03 | Trung bình | `POST /auth/login` với password dài 73 byte | 500 thay vì từ chối đầu vào hoặc xác thực thất bại | 1 |
| F04 | Trung bình | `PUT /posts/{id}` với `title: null`; `PUT /channels/{id}` với `channel_name: null` | Đều 500 do cho null đi tới cột NOT NULL | 2 |
| F05 | Trung bình | `PUT /users/{id}` với email dài hơn 100 ký tự | 200 trên SQLite dù model khai báo `String(100)` | 1 |
| F06 | Trung bình | `PUT /tasks/{id}` với `title: ""` | 200, lưu tiêu đề rỗng dù lúc tạo yêu cầu ít nhất một ký tự | 1 |
| F07 | Trung bình | `POST /media/upload` với HTML nhưng khai báo `image/png` | 200, lưu file `.html` chứa script | 1 |
| F08 | Trung bình | Xóa media đang gắn bài, bài có metric/lịch, kênh có lịch | Đều 500 khi khóa ngoại ngăn xóa | 3 |

### F01 — truy cập và tự nâng quyền qua API người dùng

Nguồn: `backend/routers/users.py`, các route chỉ dùng `Depends(get_db)`, không dùng `get_current_user` hoặc `require_roles`.

Tái hiện với database kiểm thử:

1. Gửi `GET /users/` không có Authorization → **200**, nhận danh sách tài khoản.
2. Gửi `POST /users/` không có Authorization, body gồm username/email hợp lệ, mật khẩu đủ dài và `role_id: 10` → **201**, tạo Admin.
3. Đăng nhập tài khoản `other` (Editor), gửi `PATCH /users/4/role` với `{"role_id": 10}` → **200**, tài khoản trở thành Admin. Test khôi phục vai trò sau bước này để không làm sai các kiểm tra tiếp theo.

Tài liệu `docs/user-management.md` đã ghi nhận router chưa tích hợp xác thực. Kết quả này xác nhận giới hạn hiện tại bằng request thực tế. Cần yêu cầu đăng nhập và quyền Admin tại server cho các thao tác quản trị, đồng thời chốt quyền đọc danh sách/thông tin tài khoản.

### F02 — quyền task phụ thuộc ID thay vì vai trò

Nguồn: `backend/routers/tasks.py:139`.

Tạo task giao cho Editor ID 3. Cùng request `PATCH /tasks/{id}/status` với trạng thái hợp lệ: Admin/Manager có ID vai trò 10/20 nhận **403**, còn Viewer có ID vai trò 1 nhận **200**. Các endpoint khác dùng tên vai trò qua `require_roles`, vì vậy cách kiểm tra ở task không nhất quán.

Cần xác định quyền quản trị theo vai trò/quyền được cấu hình, kết hợp kiểm tra người được giao task. Biểu hiện trên database thật phụ thuộc cách gán ID vai trò.

### F03 — đăng nhập với mật khẩu quá dài gây lỗi server

Nguồn: `backend/routers/auth.py:42`, gọi trực tiếp `bcrypt.checkpw`; schema `UserLogin` không chặn độ dài byte.

Gửi tài khoản đang hoạt động với password `"a" * 73` → **500** trên bcrypt 5.0.0. API tạo người dùng đã có chặn 72 byte nhưng API đăng nhập chưa có. Cần kiểm tra số byte UTF-8 trước khi gọi bcrypt và trả lỗi 4xx phù hợp.

### F04, F05, F06 — validation khi cập nhật chưa đồng nhất

Nguồn: `backend/schemas.py`, các model `PostUpdate`, `ChannelUpdate`, `UserUpdate`, `TaskUpdate`.

- `{"title": null}` khi sửa bài, `{"channel_name": null}` khi sửa kênh đều qua schema rồi nhận **500** lúc commit. Cần phân biệt bỏ qua trường với gửi null cho cột bắt buộc.
- Email `"a" * 64 + "@" + "b" * 40 + ".com"` dài 109 ký tự vẫn được sửa thành công **200** trên SQLite. Cần áp giới hạn 100 ký tự cho `UserUpdate` như `UserCreate`. Chưa xác nhận MySQL thực tế sẽ báo lỗi hay cắt dữ liệu; điều đó phụ thuộc SQL mode.
- `{"title": ""}` khi sửa task được **200**. `TaskUpdate.title` thiếu `min_length=1` so với schema tạo task.

### F07 — upload chỉ tin MIME do client khai báo

Nguồn: `backend/routers/media.py:65`, MIME được kiểm tra nhưng phần mở rộng lấy trực tiếp từ filename; không kiểm tra nội dung ảnh/video.

Gửi multipart `file=("payload.html", "<script>alert(1)</script>", "image/png")` → **200**, lưu file với phần mở rộng `.html`. Cần kiểm tra nội dung thực và đối chiếu phần mở rộng với loại file cho phép. Chưa kiểm tra việc file này có được phục vụ ra trình duyệt hay dẫn tới thực thi script; test chỉ chứng minh upload chấp nhận sai loại nội dung.

### F08 — lỗi khóa ngoại khi xóa chưa được xử lý

Nguồn: `delete_media`, `delete_post`, `delete_channel` trong các router tương ứng, gọi `db.commit()` không bắt `IntegrityError`.

Với khóa ngoại bật, xóa media đã gắn bài, bài còn metric/lịch hoặc kênh còn lịch đều trả **500**. Khi tháo liên kết media rồi xóa lại thì đạt; bài và kênh không có tham chiếu cũng xóa được. Cần trả lỗi xung đột có thông điệp rõ ràng hoặc thực hiện chính sách cascade đã được thống nhất. Kết quả áp dụng cho schema ORM hiện tại; chưa xác nhận các luật cascade trong MySQL thật.

## Ghi nhận thêm và giới hạn

- `backend/main.py` khai báo `GET /` hai lần (dòng 31 và 74), làm phát sinh cảnh báo trùng Operation ID khi sinh OpenAPI. Request vẫn trả 200.
- TestClient phát cảnh báo Starlette về httpx bị deprecated; không làm các test thất bại.
- Bộ mở rộng cố ý trả exit code **1** khi còn ca không đạt, đồng thời ghi đủ kết quả vào `docs/api-test-results.json`.
- Chưa kiểm tra MySQL thật, migration/schema triển khai, `GET /test-db`, cạnh tranh transaction/khóa đồng thời khi giữ Admin cuối cùng, frontend qua trình duyệt, hiệu năng/tải hoặc đăng bài ra nền tảng bên ngoài.
- SQLite không thực thi giới hạn chiều dài VARCHAR như MySQL, cũng không mô phỏng row lock `FOR UPDATE`. Các kết quả về xác thực, quyền, mã HTTP và validation đã được kiểm tra trên ứng dụng; cần lượt integration test trên MySQL riêng để xác nhận hành vi phụ thuộc database.

## Chạy lại

Từ thư mục gốc dự án:

```powershell
backend/.venv/Scripts/python.exe -B -m unittest discover -s backend/tests -v
backend/.venv/Scripts/python.exe -B backend/tests/check_branch_api.py
```

File `check_branch_api.py` chạy độc lập, không nằm trong pattern `test*.py` của unittest discovery. Kết quả từng request, mã kỳ vọng và mã thực nhận nằm trong `docs/api-test-results.json`; token đăng nhập và thông tin kết nối database không được ghi vào báo cáo này.
