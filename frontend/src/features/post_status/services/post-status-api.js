(() => {
  'use strict';

  const API_BASE = (window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  function getSession() {
    return window.MediaHubAuth?.getSession?.() ?? null;
  }

  class ApiError extends Error {
    constructor(status, detail) {
      super(typeof detail === 'string' ? detail : detail?.message || `HTTP ${status}`);
      this.status = status;
      this.detail = detail;
    }
  }

  async function request(path, options = {}) {
    const session = getSession();
    if (!session?.access_token) {
      throw new ApiError(401, 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tiếp tục.');
    }
    const headers = { Accept: 'application/json' };
    headers.Authorization = `${session.token_type || 'bearer'} ${session.access_token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: options.method || 'GET', headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError(0, 'Không thể kết nối máy chủ. Kiểm tra kết nối rồi thử lại.');
    }
    let data = null;
    try { data = await response.json(); } catch { /* Phản hồi không có nội dung JSON */ }
    if (!response.ok) throw new ApiError(response.status, data?.detail ?? null);
    return data;
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
