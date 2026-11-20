import json, os, urllib.request, urllib.error

# Kiểm tra API duyệt nội dung (T0427C8) trên server đang chạy (cổng 8000).
# Đặt biến môi trường rồi chạy:  python check_approvals.py
#   STAFF_LOGIN   / STAFF_PASSWORD   : tài khoản Nhân viên (vai trò KHÔNG phải Admin/Manager)
#   MANAGER_LOGIN / MANAGER_PASSWORD : tài khoản Người quản lý (Manager)
# Script tự tạo vài bài viết thử (tiêu đề bắt đầu bằng "[TEST DUYET]") và xóa lại khi xong.
BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000")


def call(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except ValueError:
            return e.code, {}


def login(name, password):
    s, d = call("POST", "/auth/login", {"username_or_email": name, "password": password})
    if s != 200:
        raise SystemExit(f"Đăng nhập {name} thất bại ({s}): {d}")
    return d["access_token"]


STAFF = login(os.environ["STAFF_LOGIN"], os.environ["STAFF_PASSWORD"])
MANAGER = login(os.environ["MANAGER_LOGIN"], os.environ["MANAGER_PASSWORD"])
failed = 0


def check(name, ok):
    global failed
    failed += 0 if ok else 1
    print("PASS" if ok else "FAIL", "-", name)


def new_post(token, title):
    s, d = call("POST", "/posts/", {"title": f"[TEST DUYET] {title}", "content": "<p>Nội dung thử</p>"}, token)
    assert s == 200, f"Không tạo được bài thử ({s}): {d}"
    return d["id"]


def mine(token, post_id):
    s, d = call("GET", "/approvals/mine", None, token)
    return next((p for p in d if p["id"] == post_id), None) if s == 200 else None


created = []
try:
    s, me = call("GET", "/approvals/me", None, STAFF)
    if s != 200:
        raise SystemExit(
            f"GET /approvals/me trả về {s}: {me}\n"
            "Nếu là 404: backend chưa nạp router duyệt nội dung. Kiểm tra backend/main.py đã có "
            "'from routers.approvals import router as approvals_router' và 'app.include_router(approvals_router)', "
            "rồi khởi động lại backend và mở http://127.0.0.1:8000/docs xem có nhóm Approvals chưa."
        )
    check("Nhân viên: can_review = False", me["can_review"] is False)
    s, me = call("GET", "/approvals/me", None, MANAGER)
    check("Quản lý: can_review = True", s == 200 and me["can_review"] is True)
    manager_id = me["id"]

    pid = new_post(STAFF, "luồng chính")
    created.append(pid)
    check("Bài mới tạo ở trạng thái Nháp", mine(STAFF, pid)["status"] == "draft")

    s, _ = call("POST", f"/approvals/{pid}/submit")
    check("Chưa đăng nhập gửi duyệt -> 401/403", s in (401, 403))
    s, _ = call("POST", f"/approvals/{pid}/approve", None, MANAGER)
    check("Duyệt thẳng bài Nháp (bỏ qua Chờ duyệt) -> 409", s == 409)
    s, _ = call("POST", f"/approvals/{pid}/submit", None, MANAGER)
    check("Người khác gửi duyệt bài không phải của mình -> 403", s == 403)

    s, d = call("POST", f"/approvals/{pid}/submit", None, STAFF)
    check("Nhân viên gửi duyệt -> 200, trạng thái Chờ duyệt", s == 200 and d["status"] == "pending")
    s, _ = call("POST", f"/approvals/{pid}/submit", None, STAFF)
    check("Gửi duyệt lần nữa khi đang chờ -> 409", s == 409)
    s, _ = call("POST", f"/approvals/{pid}/approve", None, STAFF)
    check("Nhân viên duyệt -> 403", s == 403)
    s, _ = call("GET", "/approvals/pending", None, STAFF)
    check("Nhân viên xem danh sách chờ duyệt -> 403", s == 403)
    s, d = call("GET", "/approvals/pending", None, MANAGER)
    check("Quản lý thấy bài trong danh sách chờ duyệt", s == 200 and any(p["id"] == pid for p in d))

    s, _ = call("POST", f"/approvals/{pid}/reject", {}, MANAGER)
    check("Từ chối không có lý do -> 422", s == 422)
    s, _ = call("POST", f"/approvals/{pid}/reject", {"reason": "   "}, MANAGER)
    check("Từ chối với lý do toàn khoảng trắng -> 422", s == 422)
    check("Sau khi từ chối lỗi, bài vẫn Chờ duyệt", mine(STAFF, pid)["status"] == "pending")

    s, d = call("POST", f"/approvals/{pid}/reject", {"reason": "Sai chính tả ở tiêu đề"}, MANAGER)
    check("Từ chối kèm lý do -> 200, trạng thái Từ chối", s == 200 and d["status"] == "rejected")
    p = mine(STAFF, pid)
    check("Nhân viên thấy lý do từ chối", p["reject_reason"] == "Sai chính tả ở tiêu đề")

    s, d = call("POST", f"/approvals/{pid}/submit", None, STAFF)
    check("Gửi duyệt lại sau khi bị từ chối -> Chờ duyệt, xóa lý do cũ", s == 200 and d["status"] == "pending" and d["reject_reason"] is None)

    s, d = call("POST", f"/approvals/{pid}/approve", None, MANAGER)
    check("Quản lý duyệt -> 200, Đã duyệt, ghi người duyệt", s == 200 and d["status"] == "approved" and d["approved_by"] == manager_id)
    s, _ = call("POST", f"/approvals/{pid}/approve", None, MANAGER)
    check("Duyệt lại bài đã duyệt -> 409", s == 409)
    s, _ = call("POST", f"/approvals/{pid}/submit", None, STAFF)
    check("Gửi duyệt bài đã duyệt -> 409", s == 409)

    own = new_post(MANAGER, "quản lý tự duyệt")
    created.append(own)
    call("POST", f"/approvals/{own}/submit", None, MANAGER)
    s, _ = call("POST", f"/approvals/{own}/approve", None, MANAGER)
    check("Người tạo tự duyệt bài của mình -> 403", s == 403)
    s, _ = call("POST", f"/approvals/{own}/reject", {"reason": "x"}, MANAGER)
    check("Người tạo tự từ chối bài của mình -> 403", s == 403)

    s, d = call("POST", "/approvals/99999999/approve", None, MANAGER)
    check("Bài không tồn tại -> 404", s == 404)

    s, logs = call("GET", "/activity-logs/", None, MANAGER)
    actions = [x["action"] for x in logs] if s == 200 else []
    if s != 200:
        print(f"     (GET /activity-logs/ trả về {s}: {logs}. Endpoint này của chức năng khác chỉ nhận vai trò tên đúng là 'Admin' hoặc 'Manager'; "
              "nếu vai trò của tài khoản quản lý đặt tên khác thì bị 403, không phải lỗi của quy trình duyệt. "
              "Kiểm tra trực tiếp: SELECT action FROM activity_logs ORDER BY id DESC LIMIT 10;)")
    check("Nhật ký có dòng Gửi duyệt / Duyệt / Từ chối", all(any(a.startswith(k) for a in actions) for k in ("Gửi duyệt", "Duyệt bài viết", "Từ chối bài viết")))
finally:
    for pid in created:
        call("DELETE", f"/posts/{pid}", None, MANAGER)
    print("Đã xóa bài viết thử." if created else "")

print("\nTẤT CẢ ĐẠT" if not failed else f"\n{failed} mục KHÔNG ĐẠT")
raise SystemExit(1 if failed else 0)
