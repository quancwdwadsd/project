(() => {
  'use strict';

  const store = window.MediaHubSettings;
  const loaded = store.load();
  let config = loaded.config;
  let history = store.loadHistory();
  let pending = null;
  let toastTimer;
  const allowed = store.canConfigure(store.currentUser);
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

  // ----- Lưu cấu hình -----
  function commit({ next, changes }) {
    const saved = store.save(next);
    config = { ...next };
    const entry = {
      id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      by: store.currentUser.name,
      changes: changes.map(({ label, from, to }) => ({ label, from, to })),
    };
    const result = store.appendHistory(history, entry);
    history = result.history;
    writeForm(config);
    showErrors({});
    renderClock();
    renderHistory();
    updateDirty();
    notify(saved && result.saved ? 'Đã lưu cấu hình.' : 'Đã lưu cấu hình. Trình duyệt không cho lưu; thay đổi chỉ giữ trong lần mở này.');
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
    if (warnings.length === 0) { commit({ next, changes }); return; }
    pending = { next, changes };
    document.getElementById('impact-list').replaceChildren(...warnings.map((text) => element('li', '', text)));
    impactDialog.showModal();
    document.getElementById('impact-cancel').focus();
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
    if (request) commit(request);
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
  ['account-button', 'profile-button'].forEach((id) => document.getElementById(id).addEventListener('click', () => notify(`Bạn đang đăng nhập với tên ${store.currentUser.name}.`)));
  document.getElementById('notifications-button').addEventListener('click', () => notify('Bạn chưa có thông báo mới.'));

  // ----- Khởi tạo -----
  document.getElementById('settings-fieldset').disabled = !allowed;
  document.getElementById('access-denied').hidden = allowed;
  document.getElementById('settings-form').hidden = !allowed;
  document.getElementById('nav-settings').hidden = !allowed;
  writeForm(config);
  showErrors({});
  renderClock();
  renderHistory();
  updateDirty();
  setSidebar(false);
  if (loaded.warning) notify(loaded.warning);
})();

