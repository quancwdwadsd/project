(() => {
  'use strict';
  const api = window.MediaHubTasksApi;
  const state = { user: null, role: '', manager: false, users: [], tasks: [], status: '', assignee: '', query: '', busy: false };
  let toastTimer;
  const byId = (id) => document.getElementById(id);
  const labels = { pending: 'Cần làm', in_progress: 'Đang làm', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
  const priorityLabels = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' };
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function roleText(role) { return String(role || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function isManagerRole(role) { return ['admin', 'manager', 'quan ly'].includes(roleText(role)); }
  function isEmployeeRole(role) { return ['employee', 'nhan vien'].includes(roleText(role)); }
  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}`.toLocaleUpperCase('vi-VN') : (words[0]?.slice(0, 2) || '?').toLocaleUpperCase('vi-VN');
  }
  function notify(message, kind = 'success') {
    const toast = byId('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }
  function displayError(error) {
    if (error.status === 0) return error.message;
    if (error.status === 401) return 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
    if (typeof error.detail === 'string') return error.detail;
    return error.message || `Có lỗi xảy ra (mã ${error.status}).`;
  }
  function formatDate(value) {
    if (!value) return 'Chưa đặt hạn';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Hạn không hợp lệ';
    return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function userName(id) {
    const user = state.users.find((item) => Number(item.id) === Number(id));
    return user?.full_name || user?.username || user?.name || `Thành viên #${id ?? '?'}`;
  }
  function fillUsers() {
    const available = state.users.filter((user) => user.status !== false && roleText(user.role_name) === 'employee');
    const assigneeSelect = byId('task-assignee');
    assigneeSelect.replaceChildren(new Option('Chọn nhân viên', ''));
    available.forEach((user) => assigneeSelect.add(new Option(user.full_name || user.username, String(user.id))));
    const filter = byId('assignee-filter');
    filter.replaceChildren(new Option('Tất cả nhân viên', ''));
    available.forEach((user) => filter.add(new Option(user.full_name || user.username, String(user.id))));
  }
  function renderSummary() {
    const all = state.tasks;
    const items = [
      ['Tổng nhiệm vụ', all.length, 'total'],
      ['Cần làm', all.filter((task) => task.status === 'pending').length, 'pending'],
      ['Đang làm', all.filter((task) => task.status === 'in_progress').length, 'progress'],
      ['Quá hạn', all.filter((task) => task.overdue).length, 'overdue'],
    ];
    byId('task-summary').replaceChildren(...items.map(([title, count, type]) => {
      const card = element('article', `task-stat${type === 'overdue' && count ? ' is-warning' : ''}`);
      card.append(element('span', 'task-stat-label', title), element('strong', 'task-stat-value', String(count)));
      return card;
    }));
  }
  function statusSelect(task) {
    const select = element('select', 'task-status-select');
    select.setAttribute('aria-label', `Cập nhật trạng thái: ${task.title}`);
    Object.entries(labels).forEach(([value, label]) => select.add(new Option(label, value)));
    select.value = task.status;
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api.updateStatus(task.id, select.value);
        notify('Đã cập nhật tiến độ nhiệm vụ.');
        await loadTasks();
      } catch (error) {
        select.value = task.status;
        notify(displayError(error), 'error');
        select.disabled = false;
      }
    });
    return select;
  }
  function renderTasks() {
    const query = state.query.trim().toLocaleLowerCase('vi-VN');
    const visible = state.tasks.filter((task) => !query || `${task.title} ${task.description || ''} ${userName(task.assigned_to)}`.toLocaleLowerCase('vi-VN').includes(query));
    byId('task-count').textContent = `${visible.length} nhiệm vụ`;
    byId('task-empty').hidden = visible.length > 0;
    const laneIds = { pending: 'lane-pending', in_progress: 'lane-in_progress', completed: 'lane-completed', cancelled: 'lane-cancelled' };
    const laneTasks = { pending: [], in_progress: [], completed: [], cancelled: [] };
    visible.forEach((task) => laneTasks[task.status]?.push(task));
    Object.keys(laneTasks).forEach((status) => {
      byId(laneIds[status]).replaceChildren(...laneTasks[status].map((task) => {
        const card = element('article', `task-card board-task-card${task.overdue ? ' is-overdue' : ''}`);
        const priority = element('span', `task-badge ${task.status === 'cancelled' ? 'status-cancelled' : `priority-${task.priority || 'medium'}`} board-priority`, task.status === 'completed' ? 'Hoàn tất' : task.status === 'cancelled' ? 'Đã hủy' : `Ưu tiên ${priorityLabels[task.priority] || 'Trung bình'}`);
        const title = element('h3', 'task-title board-task-title', task.title);
        const description = element('p', 'task-description board-task-description', task.description || '');
        const line = element('div', 'board-task-divider');
        const footer = element('div', 'board-task-footer');
        const avatar = element('span', 'board-task-avatar', initials(userName(task.assigned_to)));
        const deadline = element('span', `board-task-deadline${task.overdue ? ' deadline-overdue' : ''}`, task.status === 'completed' ? 'Đã hoàn thành' : task.status === 'cancelled' ? 'Đã hủy nhiệm vụ' : `Hạn: ${formatDate(task.due_date)}`);
        footer.append(avatar, deadline);
        if (task.overdue) footer.append(element('span', 'task-badge overdue-badge', 'Quá hạn'));
        card.append(priority, title);
        if (description.textContent) card.append(description);
        card.append(line, footer);
        if (task.status !== 'completed') {
          const statusControl = element('div', 'board-task-update');
          statusControl.append(statusSelect(task));
          card.append(statusControl);
        }
        return card;
      }));
      byId(`count-${status}`).textContent = String(laneTasks[status].length).padStart(2, '0');
    });
  }
  async function loadTasks() {
    byId('task-alert').hidden = true;
    try {
      const params = { status: state.status || undefined, assigned_to: state.manager ? (state.assignee || undefined) : undefined };
      state.tasks = await api.list(params);
      renderSummary();
      renderTasks();
    } catch (error) {
      const alert = byId('task-alert');
      alert.textContent = displayError(error);
      alert.hidden = false;
      byId('task-count').textContent = 'Không tải được';
    }
  }
  async function loadUsers() {
    state.users = await api.users();
    fillUsers();
  }
  function openCreateDialog() {
    const form = byId('task-form');
    form.reset();
    byId('task-form-error').hidden = true;
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30);
    now.setSeconds(0, 0);
    byId('task-deadline').value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    byId('task-dialog').showModal();
  }
  function closeDialog() { byId('task-dialog').close(); }
  async function createTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const due = new Date(form.elements.due_date.value);
    const data = {
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim() || null,
      assigned_to: Number(form.elements.assigned_to.value),
      due_date: due.toISOString(),
      priority: form.elements.priority.value,
    };
    const save = byId('save-task-button');
    save.disabled = true;
    try {
      await api.create(data);
      closeDialog();
      notify('Đã tạo và giao nhiệm vụ.');
      await loadTasks();
    } catch (error) {
      const err = byId('task-form-error');
      err.textContent = displayError(error);
      err.hidden = false;
    } finally {
      save.disabled = false;
    }
  }
  function setupNavigation() {
    const menu = byId('mobile-menu');
    const sidebar = byId('sidebar');
    const overlay = byId('sidebar-overlay');
    const toggle = (open) => { sidebar.classList.toggle('is-open', open); overlay.hidden = !open; menu.setAttribute('aria-expanded', String(open)); };
    menu.addEventListener('click', () => toggle(!sidebar.classList.contains('is-open')));
    overlay.addEventListener('click', () => toggle(false));
    sidebar.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => toggle(false)));
    byId('logout-button').addEventListener('click', () => { window.MediaHubAuth.endSession(); window.location.replace('./login.html'); });
  }
  async function init() {
    const current = api.session();
    if (!current?.access_token || !current?.user) { window.location.replace('./login.html'); return; }
    state.user = current.user;
    state.role = roleText(current.user.role_name || current.user.role);
    state.manager = isManagerRole(state.role);
    if (!state.manager && !isEmployeeRole(state.role)) { window.location.replace('./composer.html'); return; }
    const name = current.user.full_name || current.user.name || current.user.username || 'Người dùng';
    byId('user-name').textContent = name;
    byId('user-initial').textContent = initials(name).slice(-1);
    byId('profile-initials').textContent = initials(name);
    byId('profile-role').textContent = state.manager ? 'Quản lý' : 'Nhân viên';
    byId('create-task-button').hidden = !state.manager;
    document.querySelectorAll('.manager-filter').forEach((node) => { node.hidden = !state.manager; });
    setupNavigation();
    byId('status-filter').addEventListener('change', (event) => { state.status = event.target.value; loadTasks(); });
    byId('assignee-filter').addEventListener('change', (event) => { state.assignee = event.target.value; loadTasks(); });
    byId('task-search').addEventListener('input', (event) => { state.query = event.target.value; renderTasks(); });
    byId('refresh-tasks').addEventListener('click', loadTasks);
    byId('create-task-button').addEventListener('click', openCreateDialog);
    byId('task-form').addEventListener('submit', createTask);
    document.querySelectorAll('[data-close-task-dialog]').forEach((button) => button.addEventListener('click', closeDialog));
    byId('task-dialog').addEventListener('click', (event) => { if (event.target === byId('task-dialog')) closeDialog(); });
    if (state.manager) { try { await loadUsers(); } catch (error) { notify(displayError(error), 'error'); } }
    await loadTasks();
  }
  init();
})();
