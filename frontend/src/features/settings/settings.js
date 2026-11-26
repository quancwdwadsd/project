(() => {
  'use strict';

  const store = window.MediaHubSettings;
  const api = window.MediaHubApi;
  let config = { ...store.defaults };
  let history = [];
  let user = null;
  let allowed = false;
  let saving = false;
  let pending = null;
  let toastTimer;
  const form = document.getElementById('settings-form');
  const formError = document.getElementById('form-error');
  const saveButton = document.getElementById('save-settings');
  const revertButton = document.getElementById('revert-changes');
  const dirtyNote = document.getElementById('dirty-note');
  const impactDialog = document.getElementById('impact-dialog');
  const toast = document.getElementById('toast');
  const sidebar = document.getElementById('sidebar');
  const menuToggle = document.getElementById('mobile-menu');
  const overlay = document.getElementById('sidebar-overlay');
  const logoutButton = document.getElementById('logout-button');
  const auth = window.MediaHubAuth;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function notify(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  }

  // ----- Dựng biểu mẫu từ danh sách mục cấu hình -----
  function describeBy(key) {
    return `hint-${key} err-${key}`;
  }

  function createMessages(key, def) {
    const hint = element('p', 'field-hint', def.hint);
    hint.id = `hint-${key}`;
    const error = element('p', 'field-error');
    error.id = `err-${key}`;
    error.setAttribute('role', 'alert');
    error.hidden = true;
    return [hint, error];
  }

  function createField(key, def) {
    if (def.type === 'boolean') {
      const row = element('div', 'switch-row');
      const text = element('div', 'switch-text');
      const label = element('label', 'switch-label', def.label);
      label.htmlFor = key;
      text.append(label, ...createMessages(key, def));
      const wrapper = element('span', 'switch');
      const input = element('input');
      input.type = 'checkbox';
      input.id = key;
      input.name = key;
      input.setAttribute('role', 'switch');
      input.setAttribute('aria-describedby', describeBy(key));
      wrapper.append(input, element('span', 'switch-track'));
      wrapper.lastChild.setAttribute('aria-hidden', 'true');
      row.append(text, wrapper);
      return row;
    }
    const field = element('div', 'setting-field');
    const label = element('label', '', def.type === 'number' ? `${def.label} (${def.unit})` : def.label);
    label.htmlFor = key;
    let control;
    if (def.type === 'select') {
      control = element('select');
      Object.entries(def.options).forEach(([value, text]) => control.append(new Option(text, value)));
    } else {
      control = element('input');
      control.type = 'number';
      control.inputMode = 'numeric';
      control.step = '1';
      control.min = String(def.min);
      control.max = String(def.max);
    }
    control.id = key;
    control.name = key;
    control.setAttribute('aria-describedby', describeBy(key));
    field.append(label, control, ...createMessages(key, def));
    return field;
  }

  Object.entries(store.fields).forEach(([key, def]) => {
    document.getElementById(`fields-${def.group}`).append(createField(key, def));
  });

  function writeForm(values) {
    Object.entries(store.fields).forEach(([key, def]) => {
      const control = form.elements[key];
      if (def.type === 'boolean') control.checked = values[key];
      else control.value = String(values[key]);
    });
  }

  function readForm() {
    const values = {};
    Object.entries(store.fields).forEach(([key, def]) => {
      const control = form.elements[key];
      if (def.type === 'boolean') values[key] = control.checked;
      else if (def.type === 'number') values[key] = control.value.trim() === '' ? Number.NaN : Number(control.value);
      else values[key] = control.value;
    });
    return values;
  }

  // ----- Lỗi từng trường (UC03 – A1) -----
  function showErrors(errors) {
    Object.keys(store.fields).forEach((key) => {
      const message = errors[key];
      const node = document.getElementById(`err-${key}`);
      node.textContent = message ?? '';
      node.hidden = !message;
      form.elements[key].setAttribute('aria-invalid', String(Boolean(message)));
    });
    const count = Object.keys(errors).length;
    formError.textContent = count ? `Có ${count} giá trị chưa hợp lệ. Cấu hình hiện tại được giữ nguyên, chưa có gì được lưu.` : '';
    formError.hidden = count === 0;
  }

  function clearError(key) {
    const node = document.getElementById(`err-${key}`);
    node.textContent = '';
    node.hidden = true;
    form.elements[key].setAttribute('aria-invalid', 'false');
    if (!document.querySelector('.field-error:not([hidden])')) formError.hidden = true;
  }

  function isDirty() {
    const values = readForm();
    return Object.keys(store.fields).some((key) => !Object.is(values[key], config[key]));
  }

  function updateDirty() {
    const dirty = isDirty();
    dirtyNote.textContent = dirty ? 'Có thay đổi chưa lưu.' : 'Cấu hình đang áp dụng.';
    dirtyNote.classList.toggle('is-dirty', dirty);
    saveButton.disabled = !allowed || !dirty;
    revertButton.disabled = !dirty;
  }

  function renderClock() {
    const zone = form.elements.timezone.value;
    document.getElementById('tz-preview').textContent = `Bây giờ: ${store.formatDateTime(new Date(), zone)} (${store.offsetLabel(zone)})`;
  }

  function renderHistory() {
    const list = document.getElementById('history-list');
    list.replaceChildren(...history.map((entry) => {
      const item = element('li', 'history-item');
      const meta = element('div', 'history-meta');
      const when = element('time', '', store.formatDateTime(entry.at, config.timezone));
      when.dateTime = entry.at;
      meta.append(element('span', '', entry.by), when);
      const changes = element('ul', 'history-changes');
      entry.changes.forEach((change) => changes.append(element('li', '', `${change.label}: ${change.from} → ${change.to}`)));
      item.append(meta, changes);
      return item;
    }));
    document.getElementById('history-empty').hidden = history.length !== 0;
    document.getElementById('history-list').hidden = history.length === 0;
  }

  // ----- Lưu cấu hình vào database qua API -----
  function askConfirm(request, warnings) {
    pending = request;
    document.getElementById('impact-list').replaceChildren(...warnings.map((text) => element('li', '', text)));
    impactDialog.showModal();
    document.getElementById('impact-cancel').focus();
  }

  function handleSaveError(error, next, changes) {
    const detail = error.detail;
    if (error.status === 422 && detail && typeof detail === 'object' && detail.errors) {
      showErrors(detail.errors);
      const first = Object.keys(detail.errors).find((key) => key in store.fields);
      if (first) form.elements[first].focus();
      notify('Cấu hình chưa hợp lệ nên chưa được lưu. Cấu hình cũ vẫn đang áp dụng.');
    } else if (error.status === 409 && detail && Array.isArray(detail.impacts)) {
      askConfirm({ next, changes }, detail.impacts);
    } else if (error.status === 401) {
      goToLogin();
    } else if (error.status === 403) {
      notify('Bạn không có quyền thay đổi cấu hình hệ thống.');
    } else if (error.status === 0) {
      notify('Không kết nối được máy chủ. Cấu hình chưa được lưu, cấu hình cũ vẫn đang áp dụng.');
    } else {
      notify((detail && detail.message) || (typeof detail === 'string' ? detail : 'Không lưu được cấu hình. Cấu hình cũ vẫn đang áp dụng.'));
    }
  }

  async function persist(next, changes, confirmImpact) {
    if (saving) return;
    saving = true;
    saveButton.disabled = true;
    const payload = {};
    changes.forEach(({ key }) => { payload[key] = next[key]; });
    try {
      const result = await api.saveSettings(payload, confirmImpact);
      config = { ...store.defaults, ...result.values };
      writeForm(config);
      showErrors({});
      renderClock();
      try { history = toEntries(await api.getHistory()); } catch { /* tải lại lịch sử lỗi thì giữ bản cũ */ }
      renderHistory();
      renderLastUpdate();
      notify('Đã lưu cấu hình vào hệ thống.');
    } catch (error) {
      handleSaveError(error, next, changes);
    } finally {
      saving = false;
      updateDirty();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!allowed) { notify('Bạn không có quyền thay đổi cấu hình hệ thống.'); return; }
    const next = readForm();
    const errors = store.validate(next);
    showErrors(errors);
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      form.elements[firstError].focus();
      notify('Cấu hình chưa hợp lệ nên chưa được lưu. Cấu hình cũ vẫn đang áp dụng.');
      return;
    }
    const changes = store.diff(config, next);
    if (changes.length === 0) { notify('Không có thay đổi để lưu.'); return; }
    const warnings = store.impacts(config, next);
    if (warnings.length === 0) { persist(next, changes, false); return; }
    askConfirm({ next, changes }, warnings);
  });

  form.addEventListener('input', (event) => {
    if (event.target.name in store.fields) clearError(event.target.name);
    if (event.target.name === 'timezone') renderClock();
    updateDirty();
  });

  document.getElementById('reset-defaults').addEventListener('click', () => {
    writeForm(store.defaults);
    showErrors({});
    renderClock();
    updateDirty();
    notify('Đã nạp giá trị mặc định. Chọn Lưu cấu hình để áp dụng.');
  });
  revertButton.addEventListener('click', () => {
    writeForm(config);
    showErrors({});
    renderClock();
    updateDirty();
  });

  function closeImpact() { pending = null; impactDialog.close(); }
  document.getElementById('impact-cancel').addEventListener('click', closeImpact);
  document.getElementById('impact-close').addEventListener('click', closeImpact);
  impactDialog.addEventListener('close', () => { pending = null; saveButton.focus(); });
  document.getElementById('impact-confirm').addEventListener('click', () => {
    const request = pending;
    pending = null;
    impactDialog.close();
    if (request) persist(request.next, request.changes, true);
  });

  // ----- Thanh điều hướng (cùng cách làm với trang Người dùng) -----
  function setSidebar(open) {
    sidebar.classList.toggle('is-open', open);
    sidebar.inert = window.matchMedia('(max-width: 700px)').matches && !open;
    overlay.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('a').focus();
  }
  menuToggle.addEventListener('click', () => setSidebar(!sidebar.classList.contains('is-open')));
  overlay.addEventListener('click', () => { setSidebar(false); menuToggle.focus(); });
  window.matchMedia('(min-width: 701px)').addEventListener('change', () => setSidebar(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar.classList.contains('is-open')) { setSidebar(false); menuToggle.focus(); }
    if (event.key === 'Tab' && sidebar.classList.contains('is-open')) {
      const controls = sidebar.querySelectorAll('a, button');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => notify(`Mục ${button.dataset.section} chưa có trong bản giao diện này.`)));
  ['account-button', 'profile-button'].forEach((id) => document.getElementById(id).addEventListener('click', () => notify(user ? `Bạn đang đăng nhập với tài khoản ${user.username}.` : 'Bạn chưa đăng nhập.')));
  document.getElementById('notifications-button').addEventListener('click', () => notify('Bạn chưa có thông báo mới.'));

  // ----- Đăng nhập và tải dữ liệu từ API -----
  const LOG_PATTERN = /^Đổi cấu hình (.+?): (.+) → (.+)$/;

  // Mỗi dòng nhật ký là một mục được đổi. Gộp các dòng cùng người, cùng thời điểm thành một lần lưu.
  function toEntries(rows) {
    const grouped = new Map();
    rows.forEach((row) => {
      const match = LOG_PATTERN.exec(row.action);
      if (!match) return;
      const key = `${row.user_id}|${row.created_at}`;
      if (!grouped.has(key)) grouped.set(key, { id: key, by: row.username ?? 'Không rõ', at: row.created_at, changes: [] });
      grouped.get(key).changes.unshift({ label: match[1], from: match[2], to: match[3] });
    });
    return [...grouped.values()];
  }

  const views = { form: 'settings-form', denied: 'access-denied', error: 'load-error' };
  // UC01 dùng session chung; trang cấu hình không còn loginPanel riêng.

  function setView(name) {
    Object.entries(views).forEach(([view, id]) => { document.getElementById(id).hidden = view !== name; });
    document.getElementById('nav-settings').hidden = name === 'denied';
    document.querySelector('.history-card').hidden = name !== 'form';
    document.getElementById('last-update').hidden = name !== 'form' || history.length === 0;
    logoutButton.hidden = !user;
  }

  const ROLE_LABELS = { admin: 'Quản trị viên', manager: 'Quản lý', editor: 'Biên tập viên', employee: 'Nhân viên', viewer: 'Người xem báo cáo' };

  // Logo (chữ cái đầu) và tên của người đang đăng nhập
  function initialsOf(name) {
    const words = String(name).trim().split(/[\s._-]+/).filter(Boolean);
    if (words.length === 0) return '?';
    return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function renderUser() {
    const name = user ? user.username : 'Chưa đăng nhập';
    const initials = user ? initialsOf(user.username) : '?';
    document.getElementById('user-initial').textContent = initials.charAt(0);
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-initials').textContent = initials;
    document.getElementById('user-role').textContent = user ? (ROLE_LABELS[user.role.toLowerCase()] ?? user.role) : 'Chưa đăng nhập';
    document.getElementById('account-button').title = user ? `${user.username} (${user.email})` : '';
  }

  // "Cập nhật lần cuối bởi ... lúc ..." lấy từ dòng lịch sử mới nhất (người lưu được ghi ở database)
  function renderLastUpdate() {
    const node = document.getElementById('last-update');
    node.hidden = history.length === 0;
    if (history.length === 0) return;
    const latest = history[0];
    const strong = element('strong', '', latest.by);
    node.replaceChildren('Cập nhật lần cuối bởi ', strong, ` lúc ${store.formatDateTime(latest.at, config.timezone)}.`);
  }

  function goToLogin() {
    auth?.endSession();
    window.location.replace('./login.html');
  }

  function handleLoadError(error) {
    if (error.status === 401) {
      goToLogin();
    } else if (error.status === 403) {
      setView('denied');
    } else {
      setView('error');
    }
  }

  async function loadAll() {
    try {
      user = await api.me();
    } catch (error) {
      handleLoadError(error);
      return;
    }
    allowed = user.can_configure === true;
    renderUser();
    if (!allowed) { setView('denied'); return; }
    try {
      const [settings, rows] = await Promise.all([api.getSettings(), api.getHistory()]);
      config = { ...store.defaults, ...settings.values };
      history = toEntries(rows);
    } catch (error) {
      handleLoadError(error);
      return;
    }
    document.getElementById('settings-fieldset').disabled = false;
    setView('form');
    writeForm(config);
    showErrors({});
    renderClock();
    renderHistory();
    renderLastUpdate();
    updateDirty();
  }


  logoutButton.addEventListener('click', () => { auth?.endSession(); window.location.replace('./login.html'); });
  document.getElementById('manage-plan').addEventListener('click', () => notify('Workspace Pro là thông tin trong mẫu thiết kế. Chưa kết nối quản lý gói.'));
  document.getElementById('retry-load').addEventListener('click', loadAll);

  // ----- Khởi tạo -----
  setSidebar(false);
  if (api.getToken()) loadAll();
  else window.location.replace('./login.html');
})();
