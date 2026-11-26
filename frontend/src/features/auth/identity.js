(() => {
  'use strict';
  const auth = window.MediaHubAuth;
  if (!auth || !document.body.classList.contains('workspace-app')) return;

  const returnTo = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const state = auth.checkSession();
  if (!state.user) {
    const params = new URLSearchParams({ reason: state.reason });
    window.location.replace(`./login.html?${params}`);
    return;
  }

  function imageFor(node, user) {
    const url = user.avatar_url;
    const initial = auth.initials(user.name).short;
    node.textContent = initial;
    node.style.backgroundImage = '';
    node.classList.remove('has-avatar-image');
    node.dataset.avatarSource = url || '';
    if (!url) return;
    const imageUrl = new URL(url, auth.API_BASE_URL).href;
    const image = new Image();
    image.onload = () => {
      if (node.dataset.avatarSource !== url) return;
      node.style.backgroundImage = `url("${imageUrl}")`;
      node.classList.add('has-avatar-image');
      node.textContent = '';
    };
    image.onerror = () => {
      if (node.dataset.avatarSource !== url) return;
      node.style.backgroundImage = '';
      node.classList.remove('has-avatar-image');
      node.textContent = initial;
    };
    image.src = imageUrl;
  }

  function draw(user) {
    document.querySelectorAll('[data-user-name]').forEach((node) => { node.textContent = user.name; });
    document.querySelectorAll('[data-user-email]').forEach((node) => { node.textContent = user.email || ''; });
    document.querySelectorAll('[data-user-role]').forEach((node) => { node.textContent = user.role || 'Thành viên'; });
    document.querySelectorAll('[data-user-initial],[data-user-initials]').forEach((node) => imageFor(node, user));
  }

  function installAccountDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'account-dialog';
    dialog.id = 'account-dialog';
    dialog.innerHTML = `<form method="dialog" class="account-dialog-card"><button class="account-dialog-close" aria-label="Đóng">×</button><p class="eyebrow">Tài khoản MediaHub</p><div class="account-dialog-person"><span class="avatar account-dialog-avatar" data-user-initial></span><div><strong data-user-name></strong><span data-user-email></span><span data-user-role></span></div></div><div class="account-info-panel" hidden></div><label class="button button-secondary account-avatar-upload">Cập nhật ảnh đại diện<input id="avatar-upload" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><button class="button button-secondary" type="button" id="account-info">Thông tin tài khoản</button><button class="button button-secondary" type="button" id="switch-account">Đổi tài khoản</button><button class="button button-danger" type="button" id="account-logout">Đăng xuất</button></form>`;
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
    document.querySelectorAll('[data-account-open], #account-button, #profile-button').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
    document.getElementById('account-info').addEventListener('click', () => {
      const info = dialog.querySelector('.account-info-panel');
      info.hidden = !info.hidden;
      info.textContent = `${user.name} · ${user.email || 'Email chưa có'} · ${user.role || 'Thành viên'}`;
    });
    document.getElementById('avatar-upload').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const form = new FormData(); form.append('file', file);
      try {
        const updated = await auth.request('/auth/me/avatar', { method: 'PUT', body: form }, true);
        auth.updateUser(updated); user = auth.getSession().user; draw(user);
      } catch (error) { window.alert(error.message); }
      event.target.value = '';
    });
    const signOut = () => { auth.endSession(); window.location.replace('./login.html?reason=required'); };
    document.getElementById('account-logout').addEventListener('click', signOut);
    document.getElementById('switch-account').addEventListener('click', signOut);
  }

  function installExpiryDialog() {
    let dialog = document.getElementById('session-expired-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'session-expired-dialog';
      dialog.className = 'session-dialog';
      dialog.innerHTML = `<div class="session-dialog-card"><p class="eyebrow">Phiên đăng nhập</p><h2>Phiên của bạn đã hết hạn</h2><p>Đăng nhập lại để tiếp tục. Sau khi đăng nhập, bạn sẽ quay lại đúng trang này.</p><button type="button" class="button button-primary" id="relogin-button">Đăng nhập lại</button></div>`;
      dialog.addEventListener('cancel', (event) => event.preventDefault());
      document.body.append(dialog);
    }
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      dialog.showModal();
    };
    window.addEventListener(auth.SESSION_EVENT, show);
    document.getElementById('relogin-button').addEventListener('click', () => {
      auth.endSession();
      const params = new URLSearchParams({ reason: 'expired', returnTo: returnTo() });
      window.location.replace(`./login.html?${params}`);
    });
    const session = auth.checkSession().session;
    if (!session) return;
    const timeout = Math.max(0, session.expires_at - Date.now());
    window.setTimeout(() => {
      const current = auth.checkSession();
      if (current.session?.expires_at === session.expires_at || current.reason === 'expired') {
        auth.expireSession('expired');
      }
    }, timeout);
  }

  let user = state.user;
  installAccountDialog();
  installExpiryDialog();
  draw(user);
  const userNeedsRefresh = !state.session.user_refreshed_at || Date.now() - state.session.user_refreshed_at > 5 * 60 * 1000;
  if (userNeedsRefresh) {
    auth.getCurrentUser().then((fresh) => { auth.updateUser(fresh); user = auth.getSession()?.user || user; draw(user); }).catch(() => {});
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== 'mediahub.session.v1') return;
    const current = auth.checkSession();
    if (!current.user) window.location.replace('./login.html?reason=required');
    else { user = current.user; draw(user); }
  });
})();
