(() => {
  'use strict';
  const API_BASE = (window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');

  async function getReport(filters) {
    const session = window.MediaHubAuth?.getSession?.();
    if (!session?.access_token) {
      const error = new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để xem báo cáo.');
      error.status = 401;
      throw error;
    }
    const params = new URLSearchParams(filters);
    let response;
    try {
      response = await fetch(`${API_BASE}/reports/?${params}`, {
        headers: { Accept: 'application/json', Authorization: `${session.token_type || 'bearer'} ${session.access_token}` },
      });
    } catch {
      const error = new Error('Không kết nối được máy chủ. Kiểm tra máy chủ rồi thử lại.');
      error.status = 0;
      throw error;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(typeof data?.detail === 'string' ? data.detail : `Không tải được báo cáo (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  window.MediaHubReportsApi = Object.freeze({ getReport });
})();
