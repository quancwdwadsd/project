(() => {
  'use strict';

  const API_BASE = (window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const auth = window.MediaHubAuth;
  // Reuse the shared UC01 session. This module does not authenticate independently.
  const getToken = () => auth?.getSession()?.access_token || null;
  const clearToken = () => auth?.endSession();

  class ApiError extends Error {
    constructor(status, detail) {
      super(typeof detail === 'string' ? detail : detail?.message || `HTTP ${status}`);
      this.status = status;
      this.detail = detail;
    }
  }



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
    me: () => request('/approvals/me'),
    list,
    detail: (id) => request(`/approvals/${id}`),
    submit: (id) => request(`/approvals/${id}/submit`, { method: 'POST' }),
    approve: (id) => request(`/approvals/${id}/approve`, { method: 'POST' }),
    reject: (id, reason) => request(`/approvals/${id}/reject`, { method: 'POST', body: { reason } }),
  });
})();
