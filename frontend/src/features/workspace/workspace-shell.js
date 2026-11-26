(() => {
  'use strict';
  const pages = [
    ['dashboard.html', 'Tổng quan', 'fa-solid fa-table-cells-large'],
    ['composer.html', 'Thư viện nội dung', 'fa-regular fa-file-lines'],
    ['approvals.html', 'Duyệt nội dung', 'fa-regular fa-circle-check'],
    ['post_status.html', 'Trạng thái bài đăng', 'fa-regular fa-pen-to-square'],
    ['reports.html', 'Báo cáo phân tích', 'fa-solid fa-chart-column'],
    ['tasks.html', 'Công việc', 'fa-regular fa-square-check'],
    ['calendar.html', 'Lịch xuất bản', 'fa-regular fa-calendar-days'],
    ['user_management.html', 'Quản lý người dùng', 'fa-solid fa-users'],
    ['settings.html', 'Cấu hình hệ thống', 'fa-solid fa-gear'],
  ];
  const file = location.pathname.split('/').pop();
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  document.body.classList.add('workspace-app');
  const nav = sidebar.querySelector('.navigation');
  if (nav) {
    nav.innerHTML = pages.map(([href, label, icon]) => `<a class="nav-item${file === href ? ' is-active' : ''}" href="./${href}"${file === href ? ' aria-current="page"' : ''}><i class="workspace-nav-icon ${icon}" aria-hidden="true"></i><span>${label}</span></a>`).join('');
  }
  const brand = sidebar.querySelector('.brand');
  if (brand) brand.href = './dashboard.html';
  const upgrade = sidebar.querySelector('.upgrade-card');
  if (upgrade) upgrade.remove();
  const bottom = sidebar.querySelector('.sidebar-bottom');
  const hasMainUserName = [...document.querySelectorAll('#user-name')].some((node) => !sidebar.contains(node));
  if (bottom) {
    const old = bottom.querySelector('.account-button');
    if (old) {
      old.id = 'account-button';
      old.setAttribute('data-account-open', '');
      old.innerHTML = '<span class="avatar avatar-account" id="user-initial" data-user-initial aria-hidden="true">?</span><span class="account-name" data-user-name>Đang tải tài khoản…</span><svg class="icon" aria-hidden="true"><use href="#icon-chevron"/></svg>';
      if (!hasMainUserName) old.querySelector('[data-user-name]').id = 'user-name';
    } else {
      const account = document.createElement('button');
      account.className = 'account-button'; account.id = 'account-button'; account.type = 'button'; account.setAttribute('data-account-open', '');
      account.innerHTML = '<span class="avatar avatar-account" id="user-initial" data-user-initial aria-hidden="true">?</span><span class="account-name" data-user-name>Đang tải tài khoản…</span><svg class="icon" aria-hidden="true"><use href="#icon-chevron"/></svg>';
      if (!hasMainUserName) account.querySelector('[data-user-name]').id = 'user-name';
      bottom.append(account);
    }
    bottom.querySelectorAll('#logout-button').forEach((button) => button.remove());
  }
  document.querySelectorAll('#profile-button,.profile-button').forEach((button) => {
    button.type = 'button'; button.setAttribute('data-account-open', '');
    button.innerHTML = '<span class="avatar profile-avatar" id="profile-initials" data-user-initials aria-hidden="true">?</span><span class="profile-name" id="profile-role" data-user-name>Tài khoản</span>';
  });
})();
