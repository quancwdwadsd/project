(() => {
  'use strict';
  const API_BASE = (window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const SESSION_KEY = 'mediahub.session.v1';
  class ApiError extends Error {
    constructor(status, detail) {
      super(typeof detail === 'string' ? detail : detail?.message || `HTTP ${status}`);
      this.status = status;
      this.detail = detail;
    }
  }
  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  async function request(path, { method = 'GET', body } = {}) {
    const current = session();
    if (!current?.access_token) throw new ApiError(401, 'Phiên đăng nhập đã hết hạn.');
    const headers = { Accept: 'application/json', Authorization: `${current.token_type || 'bearer'} ${current.access_token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'Không kết nối được máy chủ. Hãy kiểm tra backend đang chạy.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, data?.detail ?? null);
    return data;
  }
  window.MediaHubTasksApi = Object.freeze({
    ApiError,
    session,
    me: () => request('/auth/me'),
    users: () => request('/users/'),
    list: ({ assigned_to, status } = {}) => {
      const params = new URLSearchParams();
      if (assigned_to) params.set('assigned_to', String(assigned_to));
      if (status) params.set('status', status);
      return request(`/tasks/${params.size ? `?${params}` : ''}`);
    },
    create: (data) => request('/tasks/', { method: 'POST', body: data }),
    update: (id, data) => request(`/tasks/${id}`, { method: 'PUT', body: data }),
    updateStatus: (id, status) => request(`/tasks/${id}/status`, { method: 'PATCH', body: { status } }),
    remove: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  });
})();
