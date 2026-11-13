(() => {
  'use strict';

  const store = window.MediaHubUsers;
  const loaded = store.load();
  let users = loaded.users;
  let editingId = null;
  let deletingId = null;
  let toastTimer;
  let dialogTrigger = null;
  let deleteTrigger = null;
  const list = document.getElementById('user-list');
  const search = document.getElementById('user-search');
  const dialog = document.getElementById('user-dialog');
  const confirmDialog = document.getElementById('confirm-dialog');
  const form = document.getElementById('user-form');
  const formError = document.getElementById('form-error');
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
    const saved = store.save(users);
    render();
    notify(saved ? message : `${message} Trình duyệt không cho lưu; thay đổi chỉ giữ trong lần mở này.`);
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
        if (action === 'edit') openForm(user, button);
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

  function openForm(user = null, trigger = document.getElementById('add-user-button')) {
    dialogTrigger = trigger;
    editingId = user?.id ?? null;
    form.reset();
    formError.hidden = true;
    document.getElementById('dialog-title').textContent = user ? 'Chỉnh sửa người dùng' : 'Thêm người dùng';
    document.getElementById('save-user-button').textContent = user ? 'Lưu thay đổi' : 'Thêm người dùng';
    if (user) {
      ['role', 'status'].forEach((key) => { form.elements[key].value = user[key]; });
    }
    dialog.showModal();
    form.elements.name.focus();
  }

  function isLastActiveAdmin(user) {
    return user.role === 'admin' && user.status === 'active'
      && users.filter((member) => member.role === 'admin' && member.status === 'active').length === 1;
  }

  function toggleUser(user) {
    if (isLastActiveAdmin(user)) {
      notify('Cần giữ ít nhất một quản trị viên đang hoạt động.');
      return;
    }
    const unlocking = user.status === 'locked';
    users = users.map((member) => member.id === user.id ? { ...member, status: unlocking ? 'active' : 'locked' } : member);
    persist(`Đã ${unlocking ? 'mở khóa' : 'khóa'} tài khoản ${user.name}.`);
  }

  function requestDelete(user, trigger) {
    if (isLastActiveAdmin(user)) {
      notify('Không thể xóa quản trị viên đang hoạt động cuối cùng.');
      return;
    }
    deletingId = user.id;
    deleteTrigger = trigger;
    document.getElementById('confirm-description').textContent = `Bạn có chắc muốn xóa ${user.name} (${user.email}) khỏi danh sách trên trình duyệt này?`;
    confirmDialog.showModal();
    document.getElementById('cancel-delete').focus();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = {
      role: form.elements.role.value,
      status: form.elements.status.value,
    };
    let error = '';
    const current = users.find((user) => user.id === editingId);
    if (current && isLastActiveAdmin(current) && (data.role !== 'admin' || data.status !== 'active')) error = 'Cần giữ ít nhất một quản trị viên đang hoạt động.';
    if (error) {
      formError.textContent = error;
      formError.hidden = false;
      return;
    }
    const isEditing = Boolean(editingId);
    if (isEditing) users = users.map((user) => user.id === editingId ? { ...user, ...data } : user);
    else users.push({ id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, ...data });
    search.value = '';
    dialog.close();
    persist(isEditing ? 'Đã cập nhật thông tin người dùng.' : 'Đã thêm người dùng vào đội ngũ.');
    document.getElementById('add-user-button').focus();
  });

  document.getElementById('add-user-button').addEventListener('click', () => openForm());
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => { if (dialogTrigger?.isConnected) dialogTrigger.focus(); });
  confirmDialog.addEventListener('close', () => { if (deleteTrigger?.isConnected) deleteTrigger.focus(); });
  document.getElementById('cancel-delete').addEventListener('click', () => confirmDialog.close());
  document.getElementById('confirm-delete').addEventListener('click', () => {
    const user = users.find((member) => member.id === deletingId);
    if (!user || isLastActiveAdmin(user)) {
      confirmDialog.close();
      return;
    }
    users = users.filter((member) => member.id !== deletingId);
    confirmDialog.close();
    persist(`Đã xóa ${user.name} khỏi danh sách.`);
    document.getElementById('add-user-button').focus();
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !dialog.open && !confirmDialog.open) { event.preventDefault(); search.focus(); }
  });

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
  document.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => notify(`Mục ${button.dataset.section} chưa có trong bản giao diện này.`)));
  document.getElementById('manage-plan').addEventListener('click', () => notify('Workspace Pro là thông tin trong mẫu thiết kế. Chưa kết nối quản lý gói.'));
  ['account-button', 'profile-button'].forEach((id) => document.getElementById(id).addEventListener('click', () => notify('Bạn đang xem không gian làm việc của Minh Quân.')));
  document.getElementById('notifications-button').addEventListener('click', () => notify('Bạn chưa có thông báo mới.'));

  setSidebar(false);
  render();
  if (loaded.warning) notify(loaded.warning);
})();
