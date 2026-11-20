(() => {
  'use strict';
  const baseUrl = (document.querySelector('meta[name="api-base-url"]')?.content || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const roles = {};
  const statuses = Object.freeze({ active: 'Hoạt động', locked: 'Đã khóa' });
  const roleNames = { admin: 'Quản trị viên', manager: 'Quản lý', editor: 'Biên tập viên', employee: 'Nhân viên', viewer: 'Người xem báo cáo' };
  const adminRoles = new Set();
  async function request(path, method = 'GET', data) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method, headers: { 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('Không kết nối được máy chủ. Vui lòng kiểm tra backend và thử lại.'); }
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const detail = result.detail;
      throw new Error(Array.isArray(detail) ? detail.map((item) => `${item.loc.at(-1)}: ${item.msg}`).join('; ') : detail || 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
    return response.status === 204 ? null : response.json();
  }
  function toUser(user) {
    return { id: user.id, name: user.username, email: user.email, role: String(user.role_id), status: user.status ? 'active' : 'locked' };
  }
  async function load() {
    const [roleList, userList] = await Promise.all([request('/users/roles'), request('/users/')]);
    Object.keys(roles).forEach((key) => delete roles[key]);
    adminRoles.clear();
    roleList.forEach((role) => {
      roles[String(role.id)] = roleNames[role.name.toLowerCase()] || role.name;
      if (role.name.toLowerCase() === 'admin') adminRoles.add(String(role.id));
    });
    return userList.map(toUser);
  }
  async function create(data) {
    return toUser(await request('/users/', 'POST', {
      username: data.name, email: data.email, password: data.password,
      role_id: Number(data.role), status: data.status === 'active',
    }));
  }
  async function updateAccess(id, role, status) {
    return toUser(await request(`/users/${id}/access`, 'PATCH', { role_id: Number(role), status: status === 'active' }));
  }
  window.MediaHubUsers = Object.freeze({ load, create, updateAccess, remove: (id) => request(`/users/${id}`, 'DELETE'), roles, statuses, isAdmin: (role) => adminRoles.has(role) });
})();
