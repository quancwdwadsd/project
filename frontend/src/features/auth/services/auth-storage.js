(() => {
  'use strict';

  const SESSION_KEY = 'mediahub.session.v1';
  const API_BASE_URL = 'http://127.0.0.1:8000';

  function getSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!session?.access_token || !session?.user || session.expires_at <= Date.now()) {
        if (session) localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function saveSession(data) {
    const user = data.user;
    const session = {
      access_token: data.access_token,
      token_type: data.token_type || 'bearer',
      expires_at: Date.now() + data.expires_in * 1000,
      user: {
        id: user.id,
        name: user.full_name || user.username,
        email: user.email,
        role: user.role_name,
      },
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async function request(path, options = {}, authenticated = false) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (authenticated) {
      const session = getSession();
      if (!session) throw Object.assign(new Error('Phiên đăng nhập đã hết hạn.'), { status: 401 });
      headers.set('Authorization', `${session.token_type} ${session.access_token}`);
    }

    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    } catch {
      throw Object.assign(new Error('Không kết nối được máy chủ. Hãy kiểm tra backend đang chạy.'), { status: 0 });
    }

    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && authenticated) endSession();
      const message = typeof data.detail === 'string' ? data.detail : 'Yêu cầu chưa thực hiện được.';
      throw Object.assign(new Error(message), { status: response.status, data });
    }
    return data;
  }

  async function register(fullName, email, password) {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ full_name: fullName, email, password }),
    });
  }

  async function login(email, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username_or_email: email, password }),
    });
    saveSession(data);
    return data.user;
  }

  async function getCurrentUser() {
    return request('/auth/me', {}, true);
  }

  function checkSession() {
    const session = getSession();
    return { user: session?.user ?? null, reason: session ? 'none' : 'expired' };
  }

  function endSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return {
      short: (parts.at(-1)?.[0] || '?').toLocaleUpperCase('vi-VN'),
      full: parts.length > 1
        ? `${parts[0][0]}${parts.at(-1)[0]}`.toLocaleUpperCase('vi-VN')
        : (parts[0]?.slice(0, 2) || '?').toLocaleUpperCase('vi-VN'),
    };
  }

  window.MediaHubAuth = Object.freeze({
    API_BASE_URL,
    request,
    register,
    login,
    getCurrentUser,
    getSession,
    checkSession,
    endSession,
    touchSession() {},
    initials,
  });
})();
