(() => {
  'use strict';

  const auth = window.MediaHubAuth;
  const api = window.MediaHubDashboardApi;
  const state = { summary: null };
  const byId = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
  const statusLabels = { draft: 'Bản nháp đã cập nhật', pending: 'Bài viết đang chờ duyệt', approved: 'Bài viết đã được duyệt', rejected: 'Bài viết cần chỉnh sửa', published: 'Bài viết đã xuất bản' };

  function initials(name) {
    return auth.initials(name);
  }

  function showError(message) {
    byId('dashboard-error-text').textContent = message;
    byId('dashboard-error').hidden = false;
    byId('dashboard-content').hidden = true;
  }

  function renderSummary(summary) {
    state.summary = summary;
    byId('dashboard-loading').hidden = true;
    byId('dashboard-content').hidden = false;
    byId('metric-engagement').textContent = number.format(summary.engagement);
    byId('metric-reach').textContent = number.format(summary.reach);
    byId('metric-published').textContent = number.format(summary.published_posts);
    byId('metric-channels').textContent = String(summary.active_channels).padStart(2, '0');
    byId('metric-tasks').textContent = number.format(summary.completed_tasks);
    byId('metric-tasks-note').textContent = `${summary.open_tasks} việc đang chờ`;

    const change = summary.engagement_change_percent;
    const changeNode = byId('engagement-change');
    if (change === null) {
      changeNode.textContent = 'Chưa có dữ liệu kỳ trước để so sánh';
      changeNode.className = 'metric-change is-neutral';
    } else {
      changeNode.textContent = `${change > 0 ? '+' : ''}${change}% so với 30 ngày trước`;
      changeNode.className = `metric-change ${change < 0 ? 'is-down' : 'is-up'}`;
    }
    renderChart(summary.weekly_engagement, summary.has_metrics);
    renderSchedule(summary.next_schedule);
    renderActivity(summary.recent_activity);
  }

  function renderChart(values, hasMetrics) {
    const chart = byId('engagement-chart');
    const empty = byId('chart-empty');
    chart.replaceChildren();
    empty.hidden = hasMetrics;
    if (!hasMetrics) return;
    const max = Math.max(...values, 1);
    values.forEach((value, index) => {
      const item = document.createElement('div');
      item.className = 'chart-column';
      const bar = document.createElement('div');
      bar.className = `chart-bar${index === values.length - 1 ? ' is-latest' : ''}`;
      bar.style.setProperty('--bar-height', `${Math.max(6, value / max * 100)}%`);
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `Tuần ${index + 1}: ${number.format(value)} lượt tương tác`);
      const label = document.createElement('span');
      label.textContent = `T${index + 1}`;
      item.append(bar, label);
      chart.append(item);
    });
  }

  function renderSchedule(schedule) {
    const empty = byId('schedule-empty');
    byId('schedule-card').hidden = !schedule;
    empty.hidden = Boolean(schedule);
    if (!schedule) return;
    const date = new Date(schedule.scheduled_time);
    byId('schedule-time').textContent = date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit',
    });
    byId('schedule-date').textContent = date.toLocaleDateString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit',
    });
    byId('schedule-title').textContent = schedule.post_title;
    byId('schedule-channel').textContent = schedule.channel_name || schedule.channel_type;
  }

  function renderActivity(items) {
    const list = byId('activity-list');
    const empty = byId('activity-empty');
    list.replaceChildren();
    empty.hidden = items.length > 0;
    items.forEach((item) => {
      const row = document.createElement('li');
      row.className = 'activity-row';
      const mark = document.createElement('span');
      mark.className = `activity-mark status-${item.status}`;
      mark.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'activity-copy';
      const title = document.createElement('strong');
      title.textContent = item.title || 'Chưa có tiêu đề';
      const detail = document.createElement('small');
      detail.textContent = statusLabels[item.status] || 'Bài viết vừa được cập nhật';
      text.append(title, detail);
      const time = document.createElement('time');
      if (item.updated_at) {
        time.dateTime = item.updated_at;
        time.textContent = new Date(item.updated_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
      }
      row.append(mark, text, time);
      list.append(row);
    });
  }

  function bindNavigation() {
    const sidebar = byId('sidebar');
    const menu = byId('mobile-menu');
    const overlay = byId('sidebar-overlay');
    const close = () => {
      sidebar.classList.remove('is-open');
      menu.setAttribute('aria-expanded', 'false');
      overlay.hidden = true;
    };
    menu.addEventListener('click', () => {
      const open = !sidebar.classList.contains('is-open');
      sidebar.classList.toggle('is-open', open);
      menu.setAttribute('aria-expanded', String(open));
      overlay.hidden = !open;
    });
    overlay.addEventListener('click', close);
    sidebar.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    byId('account-button').addEventListener('click', () => {
      const visible = byId('logout-button').hidden;
      byId('logout-button').hidden = !visible;
    });
    byId('logout-button').addEventListener('click', () => {
      auth.endSession();
      window.location.replace('../app/login.html');
    });
    byId('refresh-button').addEventListener('click', loadSummary);
    byId('retry-button').addEventListener('click', loadSummary);
  }

  async function loadSummary() {
    byId('dashboard-error').hidden = true;
    byId('dashboard-content').hidden = true;
    byId('dashboard-loading').hidden = false;
    byId('refresh-button').disabled = true;
    try {
      renderSummary(await api.summary());
    } catch (error) {
      if (error.status === 401) {
        auth.endSession();
        window.location.replace('../app/login.html?reason=expired');
        return;
      }
      showError(error.status === 0
        ? 'Không kết nối được máy chủ. Hãy kiểm tra backend đang chạy rồi thử lại.'
        : error.message || 'Chưa tải được dữ liệu tổng quan.');
    } finally {
      byId('refresh-button').disabled = false;
    }
  }

  const user = window.MediaHubIdentity.bind({ required: true });
  if (user) {
    const letters = initials(user.name);
    byId('user-name').textContent = user.name;
    byId('user-initial').textContent = letters.short;
    byId('profile-initials').textContent = letters.full;
    byId('profile-role').textContent = user.role || 'Workspace';
    bindNavigation();
    loadSummary();
  }
})();
