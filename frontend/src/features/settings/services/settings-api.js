(() => {
  'use strict';

  // Địa chỉ backend. Đổi bằng cách khai báo window.MEDIAHUB_API_BASE trước khi nạp file này.
  const API_BASE = (window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  // Read the existing session from UC01's shared auth module.
  const auth = window.MediaHubAuth;

  // Reuse the session created by UC01 (login/register). No local login/token store here.
  const getToken = () => auth?.getSession()?.access_token || null;
  const clearToken = () => auth?.endSession();

  class ApiError extends Error {
    constructor(status, detail) {
      super(typeof detail === 'string' ? detail : `HTTP ${status}`);
      this.status = status; // 0 = không kết nối được máy chủ
      this.detail = detail;
    }
  }



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


  window.MediaHubApi = Object.freeze({
    ApiError, getToken, clearToken,
    me: () => request('/settings/me'),
    getSettings: () => request('/settings/'),
    getHistory: () => request('/settings/history'),
    saveSettings: (changes, confirmImpact) => request('/settings/', { method: 'PUT', body: { changes, confirm_impact: confirmImpact } }),
  });
})();
