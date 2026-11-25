import json, os, urllib.request, urllib.error

# Chạy: đặt biến môi trường rồi chạy `python check_settings.py` (server đang chạy ở cổng 8000).
#   ADMIN_LOGIN / ADMIN_PASSWORD : tài khoản Admin
#   USER_LOGIN  / USER_PASSWORD  : tài khoản KHÔNG phải Admin
# Mật khẩu không ghi trong file này.
BASE = "http://127.0.0.1:8000"

def login(username_or_email, password):
    req = urllib.request.Request(
        BASE + "/auth/login",
        data=json.dumps({"username_or_email": username_or_email, "password": password}).encode(),
        method="POST", headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())["access_token"]

ADMIN_ID = login(os.environ["ADMIN_LOGIN"], os.environ["ADMIN_PASSWORD"])
USER_ID = login(os.environ["USER_LOGIN"], os.environ["USER_PASSWORD"])

def call(method, path, body=None, user=None):
    # user là access token (JWT) lấy từ /auth/login
    headers = {"Content-Type": "application/json"}
    if user:
        headers["Authorization"] = f"Bearer {user}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def check(name, ok):
    print("PASS" if ok else "FAIL", "-", name)

s0, _ = call("GET", "/settings/")
check("Không đăng nhập đọc cấu hình -> 401", s0 == 401)
s0, _ = call("GET", "/settings/", None, USER_ID)
check("Không phải admin đọc cấu hình -> 403", s0 == 403)
s0, me = call("GET", "/settings/me", None, USER_ID)
check("/settings/me trả tên người dùng, can_configure = False", s0 == 200 and me["can_configure"] is False and bool(me["username"]))
s0, me = call("GET", "/settings/me", None, ADMIN_ID)
check("/settings/me của admin: can_configure = True", s0 == 200 and me["can_configure"] is True)
s, d = call("GET", "/settings/", None, ADMIN_ID)
check("Admin đọc /settings/ đủ 16 mục", s == 200 and len(d["values"]) == 16)
old = d["values"]
tz_old, sess_old = old["timezone"], old["sessionMinutes"]

s, _ = call("PUT", "/settings/", {"changes": {"sessionMinutes": 45}})
check("Không đăng nhập -> 401", s == 401)
s, _ = call("PUT", "/settings/", {"changes": {"sessionMinutes": 45}}, USER_ID)
check("Không phải admin -> 403", s == 403)

new_sess = 45 if sess_old != 45 else 46
s, d2 = call("PUT", "/settings/", {"changes": {"sessionMinutes": new_sess}}, ADMIN_ID)
check("Admin đổi giá trị hợp lệ -> 200", s == 200 and d2["values"]["sessionMinutes"] == new_sess)

s, _ = call("PUT", "/settings/", {"changes": {"sessionMinutes": 2}}, ADMIN_ID)
check("Giá trị sai -> 422", s == 422)
s, d3 = call("GET", "/settings/", None, ADMIN_ID)
check("Sau khi nhập sai, cấu hình cũ được giữ", d3["values"]["sessionMinutes"] == new_sess)

new_tz = "Asia/Singapore" if tz_old != "Asia/Singapore" else "Asia/Tokyo"
s, d4 = call("PUT", "/settings/", {"changes": {"timezone": new_tz}}, ADMIN_ID)
check("Đổi múi giờ phải xác nhận -> 409", s == 409 and bool(d4["detail"]["impacts"]))
s, _ = call("PUT", "/settings/", {"changes": {"timezone": new_tz}, "confirm_impact": True}, ADMIN_ID)
check("Có xác nhận -> 200", s == 200)

if not old["apiConnect"]:
    s, _ = call("PUT", "/settings/", {"changes": {"autoPost": True}}, ADMIN_ID)
    check("Bật đăng tự động khi chưa bật API -> 422", s == 422)

s, h = call("GET", "/settings/history", None, ADMIN_ID)
check("Lịch sử có dòng 'Đổi cấu hình' kèm tên người đổi", s == 200 and any("Đổi cấu hình" in x["action"] and x["username"] for x in h))

# trả cấu hình về như cũ
call("PUT", "/settings/", {"changes": {"sessionMinutes": sess_old, "timezone": tz_old}, "confirm_impact": True}, ADMIN_ID)
print("Đã trả cấu hình về như cũ.")