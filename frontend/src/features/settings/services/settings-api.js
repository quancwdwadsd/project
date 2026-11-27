(() => {
  'use strict';

  // Địa chỉ backend. Đổi bằng cách khai báo window.MEDIAHUB_API_BASE trước khi nạp file này.
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
    try { return await window.MediaHubAuth.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, auth); }
    catch (error) { throw new ApiError(error.status || 0, error.message); }
  }


  window.MediaHubApi = Object.freeze({
    ApiError, getToken, clearToken,
    me: () => request('/settings/me'),
    getSettings: () => request('/settings/'),
    getHistory: () => request('/settings/history'),
    saveSettings: (changes, confirmImpact) => request('/settings/', { method: 'PUT', body: { changes, confirm_impact: confirmImpact } }),
  });
})();
