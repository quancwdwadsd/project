(() => {
  'use strict';

  const store = window.MediaHubUsers;
  let users = [];
  let saving = false;
  let editingId = null;
  let deletingId = null;
  let toastTimer;
  let dialogTrigger = null;
  let editTrigger = null;
  let deleteTrigger = null;
  const list = document.getElementById('user-list');
  const search = document.getElementById('user-search');
  const dialog = document.getElementById('user-dialog');
  const confirmDialog = document.getElementById('confirm-dialog');
  const form = document.getElementById('user-form');
  const formError = document.getElementById('form-error');
  const editDialog = document.getElementById('edit-user-dialog');
  const editForm = document.getElementById('edit-user-form');
  const editFormError = document.getElementById('edit-form-error');
  const toast = document.getElementById('toast');
  const sidebar = document.getElementById('sidebar');
  const menuToggle = document.getElementById('mobile-menu');
  const overlay = document.getElementById('sidebar-overlay');
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

  function notify(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  }

  function persist(message) {
    render();
    notify(message);
  }

  function setSaving(value) {
    saving = value;
    [form, editForm, confirmDialog].forEach((container) => {
      container.querySelectorAll('button, input, select').forEach((control) => { control.disabled = value; });
    });
    list.querySelectorAll('button').forEach((control) => { control.disabled = value; });
    document.getElementById('add-user-button').disabled = value;
  }

  async function loadUsers() {
    const error = document.getElementById('users-error');
    const retry = document.getElementById('retry-users');
    error.hidden = true;
    retry.hidden = true;
    document.getElementById('member-count').textContent = 'Đang tải...';
    document.getElementById('add-user-button').disabled = true;
    try {
      users = await store.load();
      [form, editForm].forEach((target) => {
        target.elements.role.replaceChildren(...Object.entries(store.roles).map(([value, label]) => new Option(label, value)));
        const defaultRole = [...target.elements.role.options].find((option) => !store.isAdmin(option.value));
        if (defaultRole) { defaultRole.defaultSelected = true; defaultRole.selected = true; }
      });
      render();
      document.getElementById('add-user-button').disabled = !Object.keys(store.roles).length;
    } catch (exception) {
      if (exception.status === 401) return;
      error.textContent = exception.message;
      error.hidden = false;
      retry.hidden = false;
      document.getElementById('member-count').textContent = 'Chưa tải được';
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createRow(user, index) {
    const row = element('article', 'user-row');
    const identity = element('div', 'user-identity');
    const avatar = element('span', `avatar user-avatar${index % 2 ? ' is-lime' : ''}`, user.name.trim().charAt(0).toUpperCase());
    avatar.setAttribute('aria-hidden', 'true');
    const details = element('div', 'user-details');
    details.append(element('h3', 'user-name', user.name), element('p', 'user-email', user.email));
    identity.append(avatar, details);
    const actions = element('div', 'user-actions');
    const button = element('button', 'icon-button user-menu-button');
    button.type = 'button';
    button.setAttribute('aria-label', `Thao tác với ${user.name}`);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `actions-${user.id}`);
    button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-more"/></svg>';
    const menu = element('div', 'user-menu');
    menu.id = `actions-${user.id}`;
    menu.hidden = true;
    const actionLabels = [['edit', 'Chỉnh sửa thông tin'], ['toggle', user.status === 'locked' ? 'Mở khóa tài khoản' : 'Khóa tài khoản'], ['delete', 'Xóa người dùng']];
    actionLabels.forEach(([action, label]) => {
      const item = element('button', action === 'delete' ? 'delete-action' : '', label);
      item.type = 'button';
      item.addEventListener('click', () => {
        closeMenus();
        if (action === 'edit') openEditForm(user, button);
        if (action === 'toggle') toggleUser(user);
        if (action === 'delete') requestDelete(user, button);
      });
      menu.append(item);
    });
    button.addEventListener('click', () => {
      const shouldOpen = menu.hidden;
      closeMenus();
      menu.hidden = !shouldOpen;
      button.setAttribute('aria-expanded', String(shouldOpen));
      if (shouldOpen) menu.querySelector('button').focus();
    });
    actions.append(button, menu);
    row.append(identity, element('span', 'badge role-badge', store.roles[user.role]), element('span', `badge status-badge status-${user.status}`, store.statuses[user.status]), actions);
    return row;
  }

  function render() {
    const query = normalize(search.value.trim());
    const filtered = users.filter((user) => normalize(`${user.name} ${user.email} ${store.roles[user.role]}`).includes(query));
    list.replaceChildren(...filtered.map((user) => createRow(user, users.indexOf(user))));
    document.getElementById('member-count').textContent = `${String(filtered.length).padStart(2, '0')} người dùng`;
    const empty = document.getElementById('empty-state');
    empty.hidden = filtered.length !== 0;
    empty.querySelector('h3').textContent = query ? 'Không tìm thấy thành viên' : 'Chưa có thành viên';
    empty.querySelector('p').textContent = query ? 'Thử tìm bằng tên, email hoặc vai trò khác.' : 'Thêm người dùng đầu tiên vào đội ngũ của bạn.';
    document.getElementById('clear-search').hidden = !query;
    document.getElementById('search-summary').textContent = `Hiển thị ${filtered.length} trên ${users.length} người dùng.`;
  }

  function closeMenus(restoreFocus = false) {
    list.querySelectorAll('.user-menu:not([hidden])').forEach((menu) => {
      menu.hidden = true;
      const button = menu.previousElementSibling;
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) button.focus();
    });
  }

  function openForm() {
    dialogTrigger = document.getElementById('add-user-button');
    form.reset();
    formError.hidden = true;
    dialog.showModal();
    form.elements.name.focus();
  }

  function openEditForm(user, trigger) {
    editingId = user.id;
    editTrigger = trigger;
    editForm.reset();
    editFormError.hidden = true;
    document.getElementById('edit-user-description').textContent = `Cập nhật vai trò và trạng thái cho ${user.name} (${user.email}).`;
    editForm.elements.role.value = user.role;
    editForm.elements.status.value = user.status;
    editDialog.showModal();
    editForm.elements.role.focus();
  }

  function isLastActiveAdmin(user) {
    return store.isAdmin(user.role) && user.status === 'active'
      && users.filter((member) => store.isAdmin(member.role) && member.status === 'active').length === 1;
  }

  async function toggleUser(user) {
    if (saving) return;
    if (isLastActiveAdmin(user)) {
      notify('Cần giữ ít nhất một quản trị viên đang hoạt động.');
      return;
    }
    const unlocking = user.status === 'locked';
    setSaving(true);
    try {
      const updated = await store.updateAccess(user.id, user.role, unlocking ? 'active' : 'locked');
      users = users.map((member) => member.id === user.id ? updated : member);
      persist(`Đã ${unlocking ? 'mở khóa' : 'khóa'} tài khoản ${user.name}.`);
    } catch (error) { if (error.status !== 401) notify(error.message); }
    finally { setSaving(false); }
  }

  function requestDelete(user, trigger) {
    if (isLastActiveAdmin(user)) {
      notify('Không thể xóa quản trị viên đang hoạt động cuối cùng.');
      return;
    }
    deletingId = user.id;
    deleteTrigger = trigger;
    document.getElementById('confirm-description').textContent = `Bạn có chắc muốn xóa tài khoản ${user.name} (${user.email}) khỏi hệ thống?`;
    confirmDialog.showModal();
    document.getElementById('cancel-delete').focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    const data = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
      role: form.elements.role.value,
      status: form.elements.status.value,
    };
    let error = '';
    if (!data.name) error = 'Vui lòng nhập tên đăng nhập.';
    else if (new TextEncoder().encode(data.password).length > 72) error = 'Mật khẩu không được vượt quá 72 byte.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) error = 'Vui lòng nhập email hợp lệ.';
    else if (users.some((user) => user.email.toLowerCase() === data.email.toLowerCase())) error = 'Email này đã được sử dụng.';
    if (error) {
      formError.textContent = error;
      formError.hidden = false;
      return;
    }
    setSaving(true);
    try {
      const created = await store.create(data);
      users.push(created);
      form.reset();
      search.value = '';
      dialog.close();
      persist('Đã thêm người dùng vào database.');
    } catch (exception) {
      if (exception.status === 401) return;
      formError.textContent = exception.message;
      formError.hidden = false;
    } finally { setSaving(false); }
  });

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    const current = users.find((user) => user.id === editingId);
    if (!current) return;
    const role = editForm.elements.role.value;
    const status = editForm.elements.status.value;
    if (isLastActiveAdmin(current) && (!store.isAdmin(role) || status !== 'active')) {
      editFormError.textContent = 'Cần giữ ít nhất một quản trị viên đang hoạt động.';
      editFormError.hidden = false;
      return;
    }
    setSaving(true);
    try {
      const updated = await store.updateAccess(current.id, role, status);
      users = users.map((user) => user.id === current.id ? updated : user);
      search.value = '';
      persist('Đã lưu vai trò và trạng thái vào database.');
      editDialog.close();
    } catch (error) {
      if (error.status === 401) return;
      editFormError.textContent = error.message;
      editFormError.hidden = false;
    } finally { setSaving(false); }
  });

  document.getElementById('add-user-button').addEventListener('click', () => openForm());
  document.querySelectorAll('[data-close-edit-dialog]').forEach((button) => button.addEventListener('click', () => editDialog.close()));
  editDialog.addEventListener('close', () => {
    editingId = null;
    if (editTrigger?.isConnected) editTrigger.focus();
    else document.getElementById('add-user-button').focus();
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => { if (dialogTrigger?.isConnected) dialogTrigger.focus(); });
  confirmDialog.addEventListener('close', () => { if (deleteTrigger?.isConnected) deleteTrigger.focus(); });
  document.getElementById('cancel-delete').addEventListener('click', () => confirmDialog.close());
  document.getElementById('confirm-delete').addEventListener('click', async () => {
    if (saving) return;
    const user = users.find((member) => member.id === deletingId);
    if (!user || isLastActiveAdmin(user)) {
      confirmDialog.close();
      return;
    }
    setSaving(true);
    try {
      await store.remove(user.id);
      users = users.filter((member) => member.id !== user.id);
      confirmDialog.close();
      persist(`Đã xóa ${user.name} khỏi database.`);
    } catch (error) { if (error.status !== 401) notify(error.message); }
    finally { setSaving(false); }
  });
  search.addEventListener('input', render);
  document.getElementById('clear-search').addEventListener('click', () => { search.value = ''; render(); search.focus(); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.user-actions')) closeMenus(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenus(true);
      if (sidebar.classList.contains('is-open')) { setSidebar(false); menuToggle.focus(); }
    }
    if (event.key === 'Tab' && sidebar.classList.contains('is-open')) {
      const controls = sidebar.querySelectorAll('a, button');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !dialog.open && !editDialog.open && !confirmDialog.open) { event.preventDefault(); search.focus(); }
  });

  function setSidebar(open) {
    sidebar.classList.toggle('is-open', open);
    sidebar.inert = window.matchMedia('(max-width: 900px)').matches && !open;
    overlay.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('a').focus();
  }
  menuToggle.addEventListener('click', () => setSidebar(!sidebar.classList.contains('is-open')));
  overlay.addEventListener('click', () => { setSidebar(false); menuToggle.focus(); });
  window.matchMedia('(min-width: 901px)').addEventListener('change', () => setSidebar(false));
  document.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => notify(`Mục ${button.dataset.section} chưa có trong bản giao diện này.`)));
  document.getElementById('notifications-button').addEventListener('click', () => notify('Bạn chưa có thông báo mới.'));

  setSidebar(false);
  [dialog, editDialog, confirmDialog].forEach((modal) => modal.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); }));
  document.getElementById('retry-users').addEventListener('click', loadUsers);
  loadUsers();
})();
