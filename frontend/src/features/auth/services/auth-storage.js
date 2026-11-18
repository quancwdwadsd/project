(() => {
  'use strict';

  const STORAGE_KEY = 'mediahub.auth.v1';

  // Du lieu mau - dung chung email voi vai nguoi trong users-storage.js cho dong bo.
  // KHONG luu mat khau o day, dung quy tac giong users-storage.js.
  const initialAccounts = [
    { id: 'acc-1', full_name: 'Nguyễn Văn A', email: 'admin@mediahub.vn' },
    { id: 'acc-2', full_name: 'Trần Thị B', email: 'tranb@mediahub.vn' },
  ];

  const isValidAccount = (account) => account && typeof account.id === 'string' && account.id.length > 0
    && typeof account.full_name === 'string' && account.full_name.trim().length > 0 && account.full_name.length <= 80
    && typeof account.email === 'string' && account.email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email);

  function load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        const accounts = JSON.parse(stored);
        if (Array.isArray(accounts) && accounts.every(isValidAccount)
          && new Set(accounts.map((a) => a.id)).size === accounts.length
          && new Set(accounts.map((a) => a.email.toLowerCase())).size === accounts.length) {
          return { accounts, warning: null };
        }
        return { accounts: structuredClone(initialAccounts), warning: 'Dữ liệu đã lưu không hợp lệ. Đang dùng danh sách mẫu.' };
      }
    } catch {
      return { accounts: structuredClone(initialAccounts), warning: 'Không đọc được dữ liệu đã lưu. Đang dùng danh sách mẫu.' };
    }
    return { accounts: structuredClone(initialAccounts), warning: null };
  }

  function save(accounts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
      return true;
    } catch {
      return false;
    }
  }

  window.MediaHubAuth = Object.freeze({ load, save });
})();