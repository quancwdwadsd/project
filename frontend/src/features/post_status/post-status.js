(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const labels = {
    draft: 'Nháp', pending: 'Đã lên lịch', publishing: 'Đang đăng', published: 'Đã đăng',
    failed: 'Thất bại', cancelled: 'Đã hủy', approved: 'Đã duyệt', rejected: 'Từ chối',
  };
  const approvalLabels = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị từ chối' };
  const tabs = [
    { id: 'all', label: 'Tất cả' }, { id: 'draft', label: 'Nháp' },
    { id: 'pending', label: 'Đã lên lịch' }, { id: 'publishing', label: 'Đang đăng' }, { id: 'published', label: 'Đã đăng' },
    { id: 'failed', label: 'Thất bại' }, { id: 'cancelled', label: 'Đã hủy' },
  ];
  let posts = [];
  let activity = [];
  let selectedPostId = null;
  let selectedTab = 'all';
  let searchQuery = '';
  let campaignFilter = '';
  let toastTimer;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function dateTime(value) {
    if (!value) return 'Chưa có thời gian';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Chưa có thời gian';
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function statusName(value) { return labels[value] || value || 'Chưa xác định'; }

  function badge(status) {
    return `<span class="status-badge" data-status="${escapeHtml(status)}">${escapeHtml(statusName(status))}</span>`;
  }

  function currentPosts() {
    return posts.filter((post) => {
      const titleMatches = !searchQuery || `${post.title} ${post.campaign_tag || ''}`.toLocaleLowerCase('vi').includes(searchQuery);
      const campaignMatches = !campaignFilter || post.campaign_tag === campaignFilter;
      const tabMatches = selectedTab === 'all' || (selectedTab === 'draft'
        ? post.approval_status === 'draft' && post.channels.length === 0
        : post.channels.some((channel) => channel.publish_status === selectedTab));
      const channelId = byId('channel-filter').value;
      const channelMatches = !channelId || post.channels.some((channel) => String(channel.channel_id) === channelId);
      return titleMatches && campaignMatches && tabMatches && channelMatches;
    });
  }

  function renderFilters() {
    const counts = {
      all: posts.length,
      draft: posts.filter((post) => post.approval_status === 'draft' && post.channels.length === 0).length,
      pending: posts.filter((post) => post.channels.some((channel) => channel.publish_status === 'pending')).length,
      publishing: posts.filter((post) => post.channels.some((channel) => channel.publish_status === 'publishing')).length,
      published: posts.filter((post) => post.channels.some((channel) => channel.publish_status === 'published')).length,
      failed: posts.filter((post) => post.channels.some((channel) => channel.publish_status === 'failed')).length,
      cancelled: posts.filter((post) => post.channels.some((channel) => channel.publish_status === 'cancelled')).length,
    };
    byId('status-filters').innerHTML = tabs.map((tab) => `<button class="status-filter${selectedTab === tab.id ? ' is-active' : ''}" type="button" data-tab="${tab.id}" aria-pressed="${selectedTab === tab.id}">${tab.label}<span class="status-filter-count">${counts[tab.id]}</span></button>`).join('');
  }

  function renderSelects() {
    const currentChannel = byId('channel-filter').value;
    const channels = new Map();
    const campaigns = new Set();
    posts.forEach((post) => {
      if (post.campaign_tag) campaigns.add(post.campaign_tag);
      post.channels.forEach((channel) => channels.set(channel.channel_id, channel.channel_name));
    });
    byId('channel-filter').innerHTML = '<option value="">Tất cả kênh</option>' + [...channels]
      .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('');
    byId('channel-filter').value = currentChannel;
    const oldCampaign = campaignFilter;
    byId('campaign-filter').innerHTML = '<option value="">Tất cả chiến dịch</option>' + [...campaigns]
      .sort((a, b) => a.localeCompare(b, 'vi')).map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    byId('campaign-filter').value = [...campaigns].includes(oldCampaign) ? oldCampaign : '';
    campaignFilter = byId('campaign-filter').value;
  }

  function renderPosts() {
    const visible = currentPosts();
    byId('list-summary').textContent = `${visible.length} bài đăng`;
    byId('empty-state').hidden = visible.length > 0;
    byId('post-list').innerHTML = visible.map((post) => {
      const channelBadges = post.channels.length
        ? post.channels.map((channel) => `<span class="channel-tag">${escapeHtml(channel.channel_name)} · ${escapeHtml(statusName(channel.publish_status))}</span>`).join('')
        : `<span class="channel-tag">${escapeHtml(approvalLabels[post.approval_status] || statusName(post.approval_status))}</span>`;
      return `<button class="post-row${selectedPostId === post.id ? ' is-selected' : ''}" type="button" data-post-id="${post.id}" aria-pressed="${selectedPostId === post.id}">
        <span class="post-row-main"><span class="post-title">${escapeHtml(post.title || 'Bài chưa có tiêu đề')}</span><span class="post-meta"><span>${escapeHtml(post.campaign_tag || 'Chưa gắn chiến dịch')}</span><span>${escapeHtml(post.created_by_name || 'Không rõ người tạo')}</span></span></span>
        <span class="post-channel-tags">${channelBadges}</span></button>`;
    }).join('');
  }

  function actionButtons(channel) {
    const state = channel.publish_status;
    const buttons = [];
    if (state === 'pending') {
      buttons.push(['published', 'Xác nhận đã đăng', 'is-primary'], ['failed', 'Ghi nhận thất bại', ''], ['cancelled', 'Hủy lịch', '']);
    } else if (state === 'publishing') {
      buttons.push(['published', 'Đã đăng thành công', 'is-primary'], ['failed', 'Ghi nhận thất bại', '']);
    } else if (state === 'failed') {
      buttons.push(['pending', 'Đưa về chờ đăng', 'is-primary']);
    }
    if (!buttons.length) return '';
    const retryNote = state === 'failed' ? '<p class="detail-action-note">Đưa về chờ đăng chỉ cập nhật trạng thái, chưa gửi bài lên nền tảng.</p>' : '';
    return `<div class="detail-channel-actions">${buttons.map(([status, label, style]) => `<button class="detail-action ${style}" type="button" data-schedule-id="${channel.schedule_id}" data-status="${status}">${label}</button>`).join('')}</div>${retryNote}<input class="detail-reason" type="url" maxlength="500" data-url-for="${channel.schedule_id}" aria-label="Đường dẫn bài đã đăng trên ${escapeHtml(channel.channel_name)}" placeholder="Link bài đã đăng (không bắt buộc)"><input class="detail-reason" type="text" maxlength="500" data-reason-for="${channel.schedule_id}" aria-label="Lý do cập nhật ${escapeHtml(channel.channel_name)}" placeholder="Ghi chú hoặc lý do (không bắt buộc)">`;
  }

  function renderHistory(history) {
    if (!history?.length) return '<p class="activity-empty">Lịch sử chuyển trạng thái sẽ xuất hiện tại đây.</p>';
    return `<ol class="detail-history">${history.map((entry) => {
      const nameFor = (status) => entry.schedule_id ? statusName(status) : (approvalLabels[status] || statusName(status));
      return `<li class="history-item"><span class="history-dot" aria-hidden="true"></span><div class="history-copy"><strong>${escapeHtml(entry.from_status ? nameFor(entry.from_status) : 'Khởi tạo')}</strong> → <strong>${escapeHtml(nameFor(entry.to_status))}</strong><span> · ${escapeHtml(entry.username || 'Hệ thống')}</span>${entry.reason ? `<div>${escapeHtml(entry.reason)}</div>` : ''}<time class="history-time">${escapeHtml(dateTime(entry.created_at))}</time></div></li>`;
    }).join('')}</ol>`;
  }

  function renderDetail(detail) {
    const title = detail.title || 'Bài chưa có tiêu đề';
    byId('detail-title').textContent = title;
    const channels = detail.channels.length ? detail.channels.map((channel) => `<div class="detail-channel">
      <div class="detail-channel-head"><span class="detail-channel-name">${escapeHtml(channel.channel_name)} <span class="post-meta">· ${escapeHtml(channel.channel_type)}</span></span>${badge(channel.publish_status)}</div>
      <p class="detail-channel-time">Dự kiến: ${escapeHtml(dateTime(channel.scheduled_time))}${channel.platform_post_id ? ` · Mã bài: ${escapeHtml(channel.platform_post_id)}` : ''}${channel.published_url ? ` · <a href="${escapeHtml(channel.published_url)}" target="_blank" rel="noopener noreferrer">Mở bài đã đăng</a>` : ''}</p>
      ${actionButtons(channel)}</div>`).join('') : '<p class="activity-empty">Bài này chưa được lên lịch trên kênh nào.</p>';
    byId('detail-content').innerHTML = `<h3 class="detail-post-title">${escapeHtml(title)}</h3>
      <div class="detail-meta"><span>Người tạo: ${escapeHtml(detail.created_by_name || 'Không rõ')}</span><span>${escapeHtml(dateTime(detail.created_at))}</span>${detail.campaign_tag ? `<span>Chiến dịch: ${escapeHtml(detail.campaign_tag)}</span>` : ''}</div>
      ${detail.content ? `<p class="detail-post-copy">${escapeHtml(detail.content)}</p>` : ''}
      <div class="detail-section-title"><span>Trạng thái theo kênh</span><span>${detail.channels.length} kênh</span></div>${channels}
      <div class="detail-section-title"><span>Lịch sử chuyển trạng thái</span><span>${detail.history?.length || 0}</span></div>${renderHistory(detail.history)}`;
    byId('status-detail-card').classList.add('is-open');
  }

  function renderActivity() {
    byId('activity-list').innerHTML = activity.length ? activity.map((entry) => {
      const name = entry.username || 'Hệ thống';
      const initials = name.trim().slice(0, 1).toLocaleUpperCase('vi');
      return `<div class="activity-row"><div class="activity-action"><span class="activity-user"><span class="activity-avatar">${escapeHtml(initials)}</span>${escapeHtml(name)}</span>${escapeHtml(entry.action)}</div><time class="activity-time">${escapeHtml(dateTime(entry.created_at))}</time></div>`;
    }).join('') : '<p class="activity-empty">Chưa có hoạt động nào được ghi nhận.</p>';
  }

  function showToast(message, isError = false) {
    const toast = byId('toast');
    toast.textContent = message;
    toast.dataset.error = String(isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function showError(error) {
    const banner = byId('status-banner');
    const message = error.status === 401
      ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để xem bài đăng.'
      : typeof error.detail === 'string' ? error.detail : error.status === 403
        ? 'Tài khoản của bạn chưa được cấp quyền xem trang này.'
        : 'Không tải được dữ liệu. Hãy kiểm tra máy chủ rồi thử lại.';
    if (error.status === 401) return;
    banner.textContent = message;
    banner.hidden = false;
    byId('reload-button').hidden = false;
  }

  async function loadData() {
    byId('loading-label').hidden = false;
    byId('status-banner').hidden = true;
    try {
      const [nextPosts, nextActivity] = await Promise.all([
        window.MediaHubPostStatusApi.list(), window.MediaHubPostStatusApi.activity(),
      ]);
      posts = nextPosts;
      activity = nextActivity;
      renderFilters();
      renderSelects();
      renderPosts();
      renderActivity();
      if (selectedPostId && posts.some((post) => post.id === selectedPostId)) await loadDetail(selectedPostId);
    } catch (error) {
      showError(error);
      if (!posts.length) {
        byId('empty-state').hidden = false;
        byId('empty-state').querySelector('strong').textContent = 'Chưa thể tải danh sách';
      }
    } finally {
      byId('loading-label').hidden = true;
    }
  }

  async function loadDetail(id) {
    selectedPostId = Number(id);
    renderPosts();
    byId('detail-title').textContent = 'Đang tải chi tiết...';
    try {
      const detail = await window.MediaHubPostStatusApi.detail(id);
      renderDetail(detail);
    } catch (error) {
      byId('detail-title').textContent = 'Không tải được chi tiết';
      showToast(typeof error.detail === 'string' ? error.detail : 'Không tải được lịch sử bài đăng.', true);
    }
  }

  async function updateStatus(button) {
    const scheduleId = Number(button.dataset.scheduleId);
    const nextStatus = button.dataset.status;
    const reasonField = document.querySelector(`[data-reason-for="${scheduleId}"]`);
    const reason = reasonField?.value.trim() || '';
    const urlField = document.querySelector(`[data-url-for="${scheduleId}"]`);
    const publishedUrl = urlField?.value.trim() || '';
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Đang lưu...';
    try {
      await window.MediaHubPostStatusApi.updateSchedule(scheduleId, nextStatus, reason, publishedUrl);
      showToast(`Đã cập nhật: ${statusName(nextStatus)}.`);
      await loadData();
    } catch (error) {
      showToast(typeof error.detail === 'string' ? error.detail : 'Không cập nhật được trạng thái.', true);
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function setupSidebar() {
    const toggle = (open) => {
      byId('sidebar').classList.toggle('is-open', open);
      byId('sidebar-overlay').hidden = !open;
      byId('mobile-menu').setAttribute('aria-expanded', String(open));
    };
    byId('mobile-menu').addEventListener('click', () => toggle(!byId('sidebar').classList.contains('is-open')));
    byId('sidebar-overlay').addEventListener('click', () => toggle(false));
    document.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => showToast(`${button.dataset.section} sẽ được nối ở phần tiếp theo.`)));
  }

  byId('status-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    selectedTab = button.dataset.tab;
    renderFilters();
    renderPosts();
  });
  byId('post-list').addEventListener('click', (event) => {
    const row = event.target.closest('[data-post-id]');
    if (row) loadDetail(row.dataset.postId);
  });
  byId('detail-content').addEventListener('click', (event) => {
    const button = event.target.closest('[data-schedule-id][data-status]');
    if (button) updateStatus(button);
  });
  byId('post-search').addEventListener('input', (event) => {
    searchQuery = event.target.value.trim().toLocaleLowerCase('vi');
    renderPosts();
  });
  byId('channel-filter').addEventListener('change', renderPosts);
  byId('campaign-filter').addEventListener('change', (event) => { campaignFilter = event.target.value; renderPosts(); });
  byId('reload-button').addEventListener('click', loadData);
  byId('close-detail').addEventListener('click', () => byId('status-detail-card').classList.remove('is-open'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') byId('status-detail-card').classList.remove('is-open');
  });

  setupSidebar();
  loadData();
})();
