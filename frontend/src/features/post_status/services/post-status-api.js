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

  async function request(path, options = {}) {
    try {
      return await auth.request(path, { method: options.method || 'GET', ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }, true);
    } catch (error) { throw new ApiError(error.status || 0, error.message); }
  }

  function list(filters = {}) {
    const params = new URLSearchParams();
    for (const key of ['status', 'channel_id', 'q']) {
      if (filters[key]) params.set(key, filters[key]);
    }
    return request(`/post-status/posts${params.size ? `?${params}` : ''}`);
  }

  window.MediaHubPostStatusApi = Object.freeze({
    ApiError,
    list,
    detail: (id) => request(`/post-status/posts/${id}`),
    activity: () => request('/post-status/activity'),
    updateSchedule: (id, publish_status, reason, published_url) => request(`/schedules/${id}/status`, {
      method: 'PATCH', body: { publish_status, reason, published_url: published_url || null },
    }),
  });
})();
