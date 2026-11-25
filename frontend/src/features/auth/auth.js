(() => {
  'use strict';

  const auth = window.MediaHubAuth;
  let toastTimer;

  function notify(message) {
    clearTimeout(toastTimer);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  }

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

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors();

      const fullName = document.getElementById('full-name').value.trim();
      const email = document.getElementById('email').value.trim();
      const pass = password.value;

      let hasError = false;
      if (fullName.length < 2) { showFieldError('full-name', 'Vui lòng nhập họ tên đầy đủ.'); hasError = true; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFieldError('email', 'Email không hợp lệ.'); hasError = true; }
      if (pass.length < 8) { showFieldError('password', 'Mật khẩu cần ít nhất 8 ký tự.'); hasError = true; }
      if (hasError) return;

      setLoading(submitBtn, true);
      try {
        await auth.register(fullName, email, pass);
        showSuccessDialog('Tạo tài khoản thành công!', 'Đang chuyển hướng tới trang đăng nhập...', 'login.html');
      } catch (error) {
        if (error.status === 409) showFieldError('email', error.message);
        else if (error.status === 422) showFieldError('password', error.message);
        else document.querySelector('.form-card .subtitle').textContent = error.message;
      } finally {
        setLoading(submitBtn, false);
      }
    });
  }

  function setupLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;

    const submitBtn = document.getElementById('submit-btn');
    const loginError = document.getElementById('login-error');
    const password = document.getElementById('password');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      loginError.textContent = '';
      password.classList.remove('has-error');

      const email = document.getElementById('email').value.trim();
      setLoading(submitBtn, true);
      try {
        await auth.login(email, password.value);
        showSuccessDialog('Đăng nhập thành công!', 'Đang chuyển tới Composer...', '../app/composer.html');
      } catch (error) {
        loginError.textContent = error.status === 401
          ? 'Email hoặc mật khẩu không chính xác.'
          : error.message;
        password.classList.add('has-error');
      } finally {
        setLoading(submitBtn, false);
      }
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
})();
