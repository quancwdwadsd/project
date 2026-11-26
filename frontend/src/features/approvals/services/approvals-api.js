(() => {
  'use strict';

  const auth = window.MediaHubAuth;
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
    try {
      return await window.MediaHubAuth.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, auth);
    } catch (error) { throw new ApiError(error.status || 0, error.message); }
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
