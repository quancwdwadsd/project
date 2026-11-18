(() => {
  'use strict';

  const store = window.MediaHubAuth;
  const loaded = store.load();
  let accounts = loaded.accounts;

  let toastTimer;

  function notify(message) {
    clearTimeout(toastTimer);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  }

  function persist(message) {
    const saved = store.save(accounts);
    if (!saved) notify(`${message} Trình duyệt không cho lưu; thay đổi chỉ giữ trong lần mở này.`);
    return saved;
  }

  // Hien popup o giua man hinh (dung <dialog> nhu users.js dang dung cho
  // hop thoai), roi tu chuyen trang sau 1 khoang thoi gian ngan.
  function showSuccessDialog(title, message, redirectUrl, delayMs = 1200) {
    const dialog = document.getElementById('success-dialog');
    if (!dialog) { window.location.href = redirectUrl; return; }
    document.getElementById('success-title').textContent = title;
    document.getElementById('success-message').textContent = message;
    dialog.showModal();
    setTimeout(() => { window.location.href = redirectUrl; }, delayMs);
  }

  function setupPasswordToggle() {
    const input = document.getElementById('password');
    const toggle = document.getElementById('toggle-password');
    if (!input || !toggle) return;
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Ẩn' : 'Hiện';
    });
  }

  // Thanh progress "chay" mach giua trang dang ky <-> dang nhap.
  function animateProgress() {
    const fill = document.getElementById('progress-fill');
    if (!fill) return;
    const target = Number(fill.dataset.progress);
    const previous = Number(sessionStorage.getItem('progressWidth') || 0);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    sessionStorage.setItem('progressWidth', target);
    if (reduceMotion) { fill.style.width = `${target}%`; return; }

    fill.style.transition = 'none';
    fill.style.width = `${previous}%`;
    void fill.offsetWidth;
    fill.style.transition = '';
    fill.style.width = `${target}%`;
  }

  function setupRegisterForm() {
    const form = document.getElementById('register-form');
    if (!form) return;

    const submitBtn = document.getElementById('submit-btn');
    const password = document.getElementById('password');
    const hint = document.getElementById('password-hint');

    password.addEventListener('input', () => {
      const ok = password.value.length >= 8;
      hint.textContent = ok ? 'Mật khẩu hợp lệ' : 'Mật khẩu cần ít nhất 8 ký tự';
      hint.classList.toggle('ok', ok);
    });

    function clearErrors() {
      document.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
      document.querySelectorAll('.field input').forEach((el) => el.classList.remove('has-error'));
    }

    function showFieldError(id, message) {
      const el = document.querySelector(`[data-error-for="${id}"]`);
      if (el) el.textContent = message;
      const input = document.getElementById(id);
      if (input) input.classList.add('has-error');
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearErrors();

      const fullName = document.getElementById('full-name').value.trim();
      const email = document.getElementById('email').value.trim();
      const pass = password.value;

      let hasError = false;
      if (fullName.length < 2) { showFieldError('full-name', 'Vui lòng nhập họ tên đầy đủ.'); hasError = true; }
      if (!email.includes('@')) { showFieldError('email', 'Email không hợp lệ.'); hasError = true; }
      if (pass.length < 8) { showFieldError('password', 'Mật khẩu cần ít nhất 8 ký tự.'); hasError = true; }
      if (hasError) return;

      const trungEmail = accounts.some((acc) => acc.email.toLowerCase() === email.toLowerCase());
      if (trungEmail) {
        showFieldError('email', 'Email này đã được sử dụng.');
        return;
      }

      // KHONG luu pass vao accounts - chi dung de validate UI, dung quy tac
      // "khong luu mat khau" giong users-storage.js.
      accounts.push({
        id: `acc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        full_name: fullName,
        email,
      });

      setLoading(submitBtn, true);
      setTimeout(() => {
        setLoading(submitBtn, false);
        persist('Tạo tài khoản thành công.');
        showSuccessDialog('Tạo tài khoản thành công!', 'Đang chuyển hướng tới trang đăng nhập...', 'login.html');
      }, 300);
    });
  }

  function setupLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;

    const submitBtn = document.getElementById('submit-btn');
    const loginError = document.getElementById('login-error');
    const password = document.getElementById('password');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      loginError.textContent = '';
      password.classList.remove('has-error');

      const email = document.getElementById('email').value.trim();
      // Day la du lieu mau, chi kiem tra email co trong danh sach da dang ky
      // hay khong - KHONG kiem tra mat khau that (vi khong luu mat khau).
      const account = accounts.find((acc) => acc.email.toLowerCase() === email.toLowerCase());

      setLoading(submitBtn, true);
      setTimeout(() => {
        setLoading(submitBtn, false);

        if (!account) {
          loginError.textContent = 'Email hoặc mật khẩu không chính xác.';
          password.classList.add('has-error');
          return;
        }

        showSuccessDialog('Đăng nhập thành công!', 'Đang chuyển hướng tới trang chính...', '../app/index.html');
      }, 300);
    });
  }

  function setLoading(button, isLoading) {
    button.disabled = isLoading;
    button.classList.toggle('loading', isLoading);
  }

  animateProgress();
  setupPasswordToggle();
  setupRegisterForm();
  setupLoginForm();
  if (loaded.warning) notify(loaded.warning);
})();