(() => {
  'use strict';
  const auth = window.MediaHubAuth;
  class ApiError extends Error {
    constructor(status, detail) {
      super(typeof detail === 'string' ? detail : detail?.message || `HTTP ${status}`);
      this.status = status;
      this.detail = detail;
    }
  }
  function session() { return auth?.getSession() || null; }
  async function request(path, { method = 'GET', body } = {}) {
    try { return await auth.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, true); }
    catch (error) { throw new ApiError(error.status || 0, error.message); }
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
