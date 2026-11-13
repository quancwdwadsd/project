(() => {
  'use strict';

  const STORAGE_KEY = 'mediahub.users.v1';
  const roles = Object.freeze({ admin: 'Quản trị viên', manager: 'Quản lý', editor: 'Biên tập viên', employee: 'Nhân viên', viewer: 'Người xem báo cáo' });
  const statuses = Object.freeze({ active: 'Hoạt động', pending: 'Chờ xác minh', locked: 'Đã khóa' });
  const initialUsers = [
    { id: 'user-1', name: 'Nguyễn Văn A', email: 'admin@mediahub.vn', role: 'admin', status: 'active' },
    { id: 'user-2', name: 'Trần Thị B', email: 'tranb@mediahub.vn', role: 'manager', status: 'active' },
    { id: 'user-3', name: 'Lê Văn C', email: 'levanc@mediahub.vn', role: 'editor', status: 'active' },
    { id: 'user-4', name: 'Phạm Thị D', email: 'phamd@mediahub.vn', role: 'employee', status: 'pending' },
  ];

  const isValidUser = (user) => user && typeof user.id === 'string' && user.id.length > 0
    && typeof user.name === 'string' && user.name.trim().length > 0 && user.name.length <= 80
    && typeof user.email === 'string' && user.email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
    && Object.hasOwn(roles, user.role) && Object.hasOwn(statuses, user.status);

  function load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        const users = JSON.parse(stored);
        if (Array.isArray(users) && users.every(isValidUser)
          && new Set(users.map((user) => user.id)).size === users.length
          && new Set(users.map((user) => user.email.toLowerCase())).size === users.length) {
          return { users, warning: null };
        }
        return { users: structuredClone(initialUsers), warning: 'Dữ liệu đã lưu không hợp lệ. Đang hiển thị danh sách mẫu.' };
      }
    } catch {
      return { users: structuredClone(initialUsers), warning: 'Không đọc được dữ liệu đã lưu. Đang hiển thị danh sách mẫu.' };
    }
    return { users: structuredClone(initialUsers), warning: null };
  }

  function save(users) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
      return true;
    } catch {
      return false;
    }
  }

  window.MediaHubUsers = Object.freeze({ load, save, roles, statuses });
})();
