(() => {
  'use strict';

  const API_BASE = (window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const TOKEN_KEY = 'mediahub.token';

  class ApiError extends Error {
    constructor(status, detail) {
      super(typeof detail === 'string' ? detail : detail?.message || `HTTP ${status}`);
      this.status = status;
      this.detail = detail;
    }
  }

  const getToken = () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  };

  const setToken = (token) => {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { return; }
  };

  const clearToken = () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { return; }
  };

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    const token = auth ? getToken() : null;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, null);
    }

    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) throw new ApiError(response.status, data?.detail ?? null);
    return data;
  }

  async function login(usernameOrEmail, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      auth: false,
      body: { username_or_email: usernameOrEmail, password },
    });
    setToken(data.access_token);
  }

  function list({ status, q, limit = 100, offset = 0 } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    return request(`/approvals/?${params}`);
  }

  window.MediaHubApprovalsApi = Object.freeze({
    ApiError,
    getToken,
    clearToken,
    login,
    me: () => request('/approvals/me'),
    list,
    detail: (id) => request(`/approvals/${id}`),
    submit: (id) => request(`/approvals/${id}/submit`, { method: 'POST' }),
    approve: (id) => request(`/approvals/${id}/approve`, { method: 'POST' }),
    reject: (id, reason) => request(`/approvals/${id}/reject`, { method: 'POST', body: { reason } }),
  });
})();
