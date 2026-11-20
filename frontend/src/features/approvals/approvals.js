(() => {
  'use strict';

  // Địa chỉ backend. Đổi bằng cách khai báo window.MEDIAHUB_API_BASE trước khi nạp file này.
  const API_BASE = (window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  // Cùng khóa với trang Cấu hình hệ thống: đăng nhập ở một trang thì trang kia dùng được luôn.
  const TOKEN_KEY = 'mediahub.token';

  const $ = (id) => document.getElementById(id);
  const state = { me: null, tab: 'mine', mine: [], pending: [], rejectingId: null };

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* chỉ dùng được trong lần mở này */ } };
  const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* bỏ qua */ } };

  // detail của FastAPI có thể là chuỗi, mảng lỗi kiểm tra dữ liệu hoặc không có
  function messageFrom(status, detail) {
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) return 'Dữ liệu gửi lên chưa hợp lệ.';
    if (status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
    if (status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
    return `Có lỗi xảy ra (mã ${status}).`;
  }

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = auth ? getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra backend đã chạy chưa.');
    }
    let data = null;
    try { data = await response.json(); } catch { /* không có nội dung JSON */ }
    if (!response.ok) throw new ApiError(response.status, messageFrom(response.status, data?.detail));
    return data;
  }

  const api = {
    login: (usernameOrEmail, password) => request('/auth/login', { method: 'POST', auth: false, body: { username_or_email: usernameOrEmail, password } }),
    me: () => request('/approvals/me'),
    mine: () => request('/approvals/mine'),
    pending: () => request('/approvals/pending'),
    submit: (id) => request(`/approvals/${id}/submit`, { method: 'POST' }),
    approve: (id) => request(`/approvals/${id}/approve`, { method: 'POST' }),
    reject: (id, reason) => request(`/approvals/${id}/reject`, { method: 'POST', body: { reason } }),
  };

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  // Nội dung bài viết là HTML từ trình soạn thảo: chỉ lấy chữ thuần, không chèn HTML vào trang.
  function plainText(html) {
    const body = new DOMParser().parseFromString(html || '', 'text/html').body;
    body.querySelectorAll('script, style').forEach((node) => node.remove());
    const text = body.textContent || '';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length > 220 ? `${trimmed.slice(0, 220)}…` : trimmed;
  }

  function formatTime(iso) {
    if (!iso) return '';
    // Backend lưu UTC không kèm múi giờ; thêm Z rồi hiển thị theo giờ Việt Nam
    const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    const b = el('button', `button ${className}`, label);
    b.type = 'button';
    b.addEventListener('click', () => onClick(b));
    return b;
  }

  function renderCard(post, tab) {
    const card = el('li', 'post-card');
    const head = el('div', 'post-head');
    const titleWrap = el('div');
    titleWrap.append(el('h3', 'post-title', post.title));
    const meta = [post.creator_name ? `Người tạo: ${post.creator_name}` : null,
      post.campaign_tag ? `#${post.campaign_tag}` : null,
      post.updated_at ? `Cập nhật ${formatTime(post.updated_at)}` : null,
      post.status === 'approved' && post.approver_name ? `Duyệt bởi ${post.approver_name}` : null].filter(Boolean);
    titleWrap.append(el('p', 'post-meta', meta.join(' · ')));
    head.append(titleWrap, el('span', `status status-${post.status}`, post.status_label));
    card.append(head);

    const excerpt = plainText(post.content);
    if (excerpt) card.append(el('p', 'post-excerpt', excerpt));
    if (post.status === 'rejected' && post.reject_reason) card.append(el('p', 'reject-note', `Lý do từ chối: ${post.reject_reason}`));

    const actions = el('div', 'post-actions');
    if (tab === 'mine' && (post.status === 'draft' || post.status === 'rejected')) {
      actions.append(button(post.status === 'rejected' ? 'Gửi duyệt lại' : 'Gửi duyệt', 'button-primary', (b) => act(b, () => api.submit(post.id), 'Đã gửi duyệt.')));
    }
    if (tab === 'pending') {
      actions.append(
        button('Duyệt', 'button-primary', (b) => act(b, () => api.approve(post.id), 'Đã duyệt nội dung.')),
        button('Từ chối', 'button-secondary', () => openReject(post)),
      );
    }
    if (actions.children.length) card.append(actions);
    return card;
  }

  function render() {
    const items = state[state.tab];
    const list = $('list');
    list.replaceChildren(...items.map((post) => renderCard(post, state.tab)));
    $('pending-count').textContent = String(state.pending.length);
    const empty = $('empty');
    empty.hidden = items.length > 0;
    empty.textContent = state.tab === 'pending' ? 'Không có nội dung nào đang chờ duyệt.' : 'Bạn chưa có bài viết nào. Tạo bài ở Thư viện nội dung.';
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.tab === state.tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
  }

  async function reload() {
    state.mine = await api.mine();
    state.pending = state.me.can_review ? await api.pending() : [];
    render();
  }

  // Chạy một thao tác, khóa nút trong lúc chờ để không bấm hai lần, rồi tải lại danh sách
  async function act(btn, action, successMessage) {
    btn.disabled = true;
    try {
      await action();
      toast(successMessage);
    } catch (error) {
      handleError(error);
    }
    try { await reload(); } catch (error) { handleError(error); }
  }

  function handleError(error) {
    if (error.status === 401) { signedOut(error.message); return; }
    toast(error.message || 'Có lỗi xảy ra.');
  }

  function openReject(post) {
    state.rejectingId = post.id;
    $('reject-post-title').textContent = post.title;
    $('reject-reason').value = '';
    showError($('reject-error'), '');
    $('reject-dialog').showModal();
    $('reject-reason').focus();
  }

  async function confirmReject(event) {
    event.preventDefault();
    const reason = $('reject-reason').value.trim();
    if (!reason) { showError($('reject-error'), 'Phải nhập lý do khi từ chối.'); return; }
    const confirmBtn = $('reject-confirm');
    confirmBtn.disabled = true;
    try {
      await api.reject(state.rejectingId, reason);
      $('reject-dialog').close();
      toast('Đã từ chối nội dung.');
    } catch (error) {
      if (error.status === 401) { $('reject-dialog').close(); handleError(error); } else showError($('reject-error'), error.message);
    } finally {
      confirmBtn.disabled = false;
    }
    try { await reload(); } catch (error) { handleError(error); }
  }

  function signedOut(message) {
    clearToken();
    state.me = null;
    $('app-panel').hidden = true;
    $('login-panel').hidden = false;
    $('logout-button').hidden = true;
    $('user-name').textContent = 'Chưa đăng nhập';
    $('user-initial').textContent = '?';
    $('user-role').textContent = 'Chưa đăng nhập';
    showError($('login-error'), message || '');
  }

  async function start() {
    showError($('load-error'), '');
    if (!getToken()) { signedOut(''); return; }
    try {
      state.me = await api.me();
      $('login-panel').hidden = true;
      $('app-panel').hidden = false;
      $('logout-button').hidden = false;
      $('user-name').textContent = state.me.username;
      $('user-initial').textContent = state.me.username.charAt(0).toUpperCase();
      $('user-role').textContent = state.me.role || 'Người dùng';
      $('tab-pending').hidden = !state.me.can_review;
      state.tab = state.me.can_review ? 'pending' : 'mine';
      await reload();
    } catch (error) {
      if (error.status === 401) signedOut(error.message);
      else showError($('load-error'), error.message);
    }
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('login-username').value.trim();
    const password = $('login-password').value;
    if (!username || !password) { showError($('login-error'), 'Nhập tên đăng nhập và mật khẩu.'); return; }
    $('login-submit').disabled = true;
    try {
      const data = await api.login(username, password);
      setToken(data.access_token);
      $('login-password').value = '';
      showError($('login-error'), '');
      await start();
    } catch (error) {
      showError($('login-error'), error.message);
    } finally {
      $('login-submit').disabled = false;
    }
  });

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { state.tab = tab.dataset.tab; render(); }));
  $('reject-form').addEventListener('submit', confirmReject);
  $('reject-cancel').addEventListener('click', () => $('reject-dialog').close());
  $('logout-button').addEventListener('click', () => signedOut(''));
  document.querySelectorAll('[data-section]').forEach((b) => b.addEventListener('click', () => toast(`Mục “${b.dataset.section}” chưa có trong bản demo.`)));

  start();
})();
