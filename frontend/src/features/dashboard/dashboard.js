const sidebar = document.getElementById('sidebar');
    const menuButton = document.getElementById('mobile-menu');
    const overlay = document.getElementById('sidebar-overlay');
    const toast = document.getElementById('dashboard-toast');
    let toastTimer;

    function setSidebarOpen(open) {
      sidebar.classList.toggle('is-open', open);
      overlay.hidden = !open;
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'Đóng thanh điều hướng' : 'Mở thanh điều hướng');
    }

    menuButton.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('is-open')));
    overlay.addEventListener('click', () => setSidebarOpen(false));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    });

    function showToast(message) {
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
    }

    document.getElementById('create-post').addEventListener('click', () => {
      window.location.href = './composer.html';
    });
    document.querySelectorAll('[data-section]').forEach((button) => {
      button.addEventListener('click', () => showToast(`${button.dataset.section} sẽ sớm được bổ sung.`));
    });

    const numberFormat = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
    const fullNumberFormat = new Intl.NumberFormat('vi-VN');
    const setText = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };
    const formatNumber = (value) => Number.isFinite(Number(value)) ? numberFormat.format(Number(value)) : '—';

    function renderEngagementChart(values) {
      const columns = [...document.querySelectorAll('#facebook-engagement-chart .chart-column')];
      const samples = Array.isArray(values) ? values.slice(-7) : [];
      const displayValues = [...Array(Math.max(0, 7 - samples.length)).fill(0), ...samples];
      const max = Math.max(1, ...displayValues.map((value) => Number(value) || 0));
      const start = new Date();
      start.setDate(start.getDate() - 6);
      columns.forEach((column, index) => {
        const value = Number(displayValues[index] || 0);
        const bar = column.querySelector('.chart-bar');
        const label = column.querySelector('.chart-label');
        if (bar) bar.style.height = `${Math.max(5, Math.round((value / max) * 100))}%`;
        if (label) {
          const day = new Date(start);
          day.setDate(start.getDate() + index);
          label.textContent = samples.length ? day.toLocaleDateString('vi-VN', { weekday: 'short' }) : '—';
        }
      });
    }

    function renderActivities(items) {
      const container = document.getElementById('dashboard-activities');
      if (!container) return;
      container.replaceChildren();
      if (!items?.length) {
        const empty = document.createElement('p');
        empty.className = 'activity-text';
        empty.textContent = 'Chưa có hoạt động gần đây.';
        container.append(empty);
        return;
      }
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'activity-row';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.classList.add('activity-check');
        icon.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#icon-check');
        icon.append(use);
        const text = document.createElement('p');
        text.className = 'activity-text';
        text.textContent = `${item.user ? `${item.user}: ` : ''}${item.action}`;
        const time = document.createElement('span');
        time.className = 'status-pill';
        time.textContent = item.created_at ? new Date(item.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'Gần đây';
        row.append(icon, text, time);
        container.append(row);
      });
    }

    async function loadDashboardSummary() {
      const auth = window.MediaHubAuth;
      if (!auth?.getSession()) {
        setText('dashboard-description', 'Đăng nhập để xem số liệu tài khoản Meta và hoạt động trong hệ thống.');
        return;
      }
      try {
        const summary = await auth.request('/dashboard/summary', {}, true);
        const database = summary.database || {};
        const meta = summary.meta || {};
        const facebook = meta.facebook || {};
        const instagram = meta.instagram || {};
        const fbProfile = facebook.profile || {};
        const igProfile = instagram.profile || {};
        const fbMetrics = facebook.metrics || {};
        const igMetrics = instagram.metrics || {};

        setText('published-count', fullNumberFormat.format(database.published_posts_28d || 0));
        setText('facebook-followers', formatNumber(fbProfile.followers_count));
        setText('facebook-engagement', formatNumber(fbMetrics.engagements_28d));
        setText('facebook-engagement-28d', formatNumber(fbMetrics.engagements_28d));
        setText('instagram-reach-28d', formatNumber(igMetrics.reach_28d));
        setText('facebook-account-name', facebook.error || fbProfile.name || 'Facebook Page Insights');
        setText('facebook-page-name', facebook.error || (facebook.connected ? `${fbProfile.name || 'Facebook Page'} · ${formatNumber(fbProfile.followers_count)} người theo dõi` : 'Chưa cấu hình Facebook Page'));
        setText('instagram-account-name', instagram.error || (igProfile.username ? `@${igProfile.username} · ${formatNumber(igProfile.followers_count)} người theo dõi` : instagram.connected ? 'Instagram Insights' : 'Chưa cấu hình Instagram'));
        const activeAccounts = [facebook, instagram].filter((account) => account.connected && !account.error).length;
        setText('dashboard-description', `${activeAccounts} tài khoản Meta lấy được dữ liệu · ${database.connected_channels || 0} kênh đang hoạt động trong workspace`);
        renderEngagementChart(facebook.daily_engagement || []);

        if (database.upcoming) {
          const when = new Date(`${database.upcoming.scheduled_time}${database.upcoming.scheduled_time.endsWith('Z') ? '' : 'Z'}`);
          setText('upcoming-time', when.toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }));
          setText('upcoming-channel', `${database.upcoming.channel_name} · ${database.upcoming.title}`);
        } else {
          setText('upcoming-time', 'Chưa có lịch sắp tới');
          setText('upcoming-channel', 'Các lịch đăng sẽ hiện ở đây.');
        }
        renderActivities(database.activities || []);
      } catch (error) {
        setText('dashboard-description', error.message || 'Chưa tải được dữ liệu Dashboard.');
        showToast(error.message || 'Không tải được số liệu Dashboard.');
      }
    }

    const scheduleButton = document.getElementById('schedule-calender');
    if (scheduleButton) {
      scheduleButton.addEventListener('click', () => {
        window.location.href = './planner.html';
      });
    }

    loadDashboardSummary();
