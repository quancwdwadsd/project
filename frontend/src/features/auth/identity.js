(() => {
  'use strict';

  const auth = window.MediaHubAuth;
  const LOGIN_URL = './login.html';
  const WATCH_INTERVAL_MS = 30 * 1000;
  const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll'];

  // Đánh dấu phần tử cần điền bằng thuộc tính data-*:
  //   data-user-name      tên đầy đủ            data-user-role      tên vai trò
  //   data-user-initial   1 chữ cái (sidebar)   data-user-initials  2 chữ cái (thanh trên)
  //   data-logout         nút đăng xuất
  function fill(user) {
    const name = user ? user.name : 'Chưa đăng nhập';
    const letters = user ? auth.initials(user.name) : { short: '?', full: '?' };
    const roleName = user ? (window.MediaHubUsers?.roles?.[user.role] ?? user.role) : '';
    document.querySelectorAll('[data-user-name]').forEach((node) => { node.textContent = name; });
    document.querySelectorAll('[data-user-initial]').forEach((node) => { node.textContent = letters.short; });
    document.querySelectorAll('[data-user-initials]').forEach((node) => { node.textContent = letters.full; });
    document.querySelectorAll('[data-user-role]').forEach((node) => { node.textContent = roleName; });
    document.querySelectorAll('[data-user-card]').forEach((node) => {
      node.setAttribute('aria-label', user ? `Tài khoản ${user.name}, ${roleName}` : 'Chưa đăng nhập');
    });
  }

  function goToLogin(reason) {
    const query = reason && reason !== 'none' ? `?reason=${encodeURIComponent(reason)}` : '';
    window.location.replace(`${LOGIN_URL}${query}`);
  }

  // required = true: trang bắt buộc phải đăng nhập, nếu chưa thì chuyển về trang đăng nhập.
  // Trả về người dùng hiện tại, hoặc null nếu chưa đăng nhập.
  function bind({ required = false } = {}) {
    const { user, reason } = auth.checkSession();
    fill(user);

    document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', () => {
      auth.endSession();
      goToLogin('none');
    }));

    if (!user) {
      if (required) goToLogin(reason);
      return null;
    }

    // Còn thao tác thì gia hạn phiên; không thao tác quá thời gian cấu hình thì tự đăng xuất.
    ACTIVITY_EVENTS.forEach((type) => document.addEventListener(type, auth.touchSession, { passive: true, capture: true }));
    if (required) {
      const verify = () => {
        const state = auth.checkSession();
        if (!state.user) goToLogin(state.reason);
      };
      setInterval(verify, WATCH_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) verify(); });
      // Đăng xuất hoặc bị khóa ở thẻ khác thì thẻ này cũng thoát.
      window.addEventListener('storage', (event) => { if (event.key === 'mediahub.session.v1') verify(); });
    }
    return user;
  }

  window.MediaHubIdentity = Object.freeze({ bind });
})();
