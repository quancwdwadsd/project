(() => {
  'use strict';

  // Địa chỉ backend. Đổi bằng cách khai báo window.MEDIAHUB_API_BASE trước khi nạp file này.
  const API_BASE = (window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  // Trang đăng nhập (UC01) của nhóm cũng nên lưu token vào đúng khóa này.
  const TOKEN_KEY = 'mediahub.token';

  class ApiError extends Error {
    constructor(status, detail) {
      super(typeof detail === 'string' ? detail : `HTTP ${status}`);
      this.status = status; // 0 = không kết nối được máy chủ
      this.detail = detail;
    }
  }

  const getToken = () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  };
  const setToken = (token) => {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* trình duyệt chặn lưu: chỉ dùng được trong lần mở này */ }
  };
  const clearToken = () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* bỏ qua */ }
  };

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = auth ? getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, null);
    }
    let data = null;
    try { data = await response.json(); } catch { /* phản hồi không có nội dung JSON */ }
    if (!response.ok) throw new ApiError(response.status, data?.detail ?? null);
    return data;
  }

  async function login(usernameOrEmail, password) {
    const data = await request('/auth/login', { method: 'POST', auth: false, body: { username_or_email: usernameOrEmail, password } });
    setToken(data.access_token);
  }

  window.MediaHubApi = Object.freeze({
    ApiError, getToken, clearToken, login,
    me: () => request('/settings/me'),
    getSettings: () => request('/settings/'),
    getHistory: () => request('/settings/history'),
    saveSettings: (changes, confirmImpact) => request('/settings/', { method: 'PUT', body: { changes, confirm_impact: confirmImpact } }),
  });
})();
