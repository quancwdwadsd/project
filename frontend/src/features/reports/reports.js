(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const form = $('report-filters');
  let currentReport = null;
  let mobileOpen = false;
  const dateInput = (date) => date.toISOString().slice(0, 10);
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  $('start-date').value = dateInput(start);
  $('end-date').value = dateInput(today);

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const fmt = (value) => value == null ? 'Không khả dụng' : new Intl.NumberFormat('vi-VN').format(value);
  const statusNames = { draft: 'Bản nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', scheduled: 'Đã lên lịch', published: 'Đã đăng' };

  function paramsFromForm() {
    const values = Object.fromEntries(new FormData(form).entries());
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
  }

  function fillFilters(filters) {
    const keep = { channel: $('channel-filter').value, campaign: $('campaign-filter').value, status: $('status-filter').value };
    $('channel-filter').innerHTML = '<option value="">Tất cả kênh</option>' + filters.channels.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('campaign-filter').innerHTML = '<option value="">Tất cả chiến dịch</option>' + filters.campaigns.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    $('status-filter').innerHTML = '<option value="">Mọi trạng thái</option>' + filters.statuses.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(statusNames[name] || name)}</option>`).join('');
    $('channel-filter').value = keep.channel;
    $('campaign-filter').value = keep.campaign;
    $('status-filter').value = keep.status;
  }

  function renderTrend(data) {
    const trend = data.trend || [];
    if (!trend.length) return '<div class="chart-empty">Chưa có snapshot số liệu trong khoảng thời gian này.</div>';
    const max = Math.max(1, ...trend.map((item) => item.views));
    return `<div class="trend-chart" role="img" aria-label="Biểu đồ lượt xem theo ngày thu thập">${trend.slice(-14).map((item) => {
      const height = Math.max(4, Math.round(item.views / max * 100));
      return `<div class="trend-column" title="${escapeHtml(item.date)} · ${fmt(item.views)} lượt xem"><span class="trend-value">${fmt(item.views)}</span><i style="--bar-height:${height}%"></i><time>${escapeHtml(item.date.slice(5))}</time></div>`;
    }).join('')}</div>`;
  }

  function renderChannels(items) {
    if (!items.length) return '<p class="empty-copy">Chưa có bài đơn kênh để so sánh trong phạm vi này.</p>';
    const max = Math.max(1, ...items.map((item) => item.interactions));
    return items.map((item, index) => `<div class="channel-row"><div class="channel-row-head"><strong>${escapeHtml(item.channel_name)}</strong><span>${fmt(item.interactions)} tương tác</span></div><div class="channel-track"><i class="channel-bar channel-${index % 4}" style="--bar-width:${Math.max(2, item.interactions / max * 100)}%"></i></div><p>${fmt(item.posts)} bài có số liệu <span>· ${fmt(item.views)} lượt xem</span></p></div>`).join('');
  }

  function renderPosts(items) {
    if (!items.length) return '<tr><td colspan="5" class="table-empty">Không có số liệu trong kỳ. Thử đổi bộ lọc hoặc khoảng ngày.</td></tr>';
    return items.map((post, index) => `<tr><td class="rank-cell">${String(index + 1).padStart(2, '0')}</td><td><strong>${escapeHtml(post.title || 'Bài chưa có tiêu đề')}</strong><small>${escapeHtml(post.campaign_tag || 'Chưa gắn chiến dịch')}</small></td><td><span class="post-channel">${escapeHtml(post.channels.join(', ') || 'Chưa gắn kênh')}</span></td><td><span class="post-status">${escapeHtml(statusNames[post.status] || post.status || '—')}</span></td><td class="number-cell">${fmt(post.interactions)}<small>${fmt(post.views)} lượt xem</small></td></tr>`).join('');
  }

  function render(report) {
    currentReport = report;
    fillFilters(report.filters);
    const totals = report.summary;
    $('kpi-views').textContent = fmt(totals.views);
    $('kpi-interactions').textContent = fmt(totals.interactions);
    $('kpi-posts').textContent = fmt(totals.posts_with_metrics);
    $('kpi-rate').textContent = totals.views ? `${(totals.interactions / totals.views * 100).toFixed(1).replace('.', ',')}%` : 'Không khả dụng';
    $('trend-chart').innerHTML = renderTrend(report);
    $('channel-list').innerHTML = renderChannels(report.by_channel);
    $('top-posts').innerHTML = renderPosts(report.top_posts);
    $('scope-summary').textContent = `${report.scope.start_date} — ${report.scope.end_date}${report.scope.channel_id ? ` · ${$('channel-filter').selectedOptions[0]?.textContent || 'Kênh đã chọn'}` : ' · Tất cả kênh'}${report.scope.campaign_tag ? ` · ${report.scope.campaign_tag}` : ''}`;
    $('source-label').textContent = report.data_quality.sources.length ? report.data_quality.sources.join(', ') : 'Chưa có snapshot';
    $('updated-label').textContent = report.data_quality.updated_at ? new Date(report.data_quality.updated_at).toLocaleString('vi-VN') : 'Chưa có dữ liệu';
    $('channel-note').textContent = `${report.data_quality.note}${report.data_quality.multi_channel_posts_not_attributed ? ` Có ${report.data_quality.multi_channel_posts_not_attributed} bài đa kênh được loại khỏi so sánh kênh.` : ''}`;
    $('report-scope').hidden = false;
    $('report-error').hidden = true;
    $('report-empty').hidden = report.summary.posts_with_metrics !== 0;
    $('report-panels').hidden = report.summary.posts_with_metrics === 0;
  }

  async function loadReport(event) {
    event?.preventDefault();
    const submit = $('run-report');
    if ($('start-date').value > $('end-date').value) {
      $('report-error').textContent = 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.';
      $('report-error').hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Đang tạo báo cáo…';
    $('loading-label').hidden = false;
    $('report-error').hidden = true;
    try {
      render(await window.MediaHubReportsApi.getReport(paramsFromForm()));
    } catch (error) {
      $('report-error').innerHTML = error.status === 401
        ? `${escapeHtml(error.message)} <a href="./login.html">Đăng nhập</a>`
        : error.status === 403 ? 'Tài khoản chưa được cấp quyền xem báo cáo.' : escapeHtml(error.message || 'Không tải được báo cáo.');
      $('report-error').hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Tạo báo cáo';
      $('loading-label').hidden = true;
    }
  }

  function exportCsv() {
    if (!currentReport) return;
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Phạm vi', currentReport.scope.start_date, currentReport.scope.end_date],
      ['Nguồn số liệu', currentReport.data_quality.sources.join('; ')],
      ['Cập nhật lần cuối', currentReport.data_quality.updated_at || 'Không khả dụng'],
      [], ['Hạng', 'Bài viết', 'Chiến dịch', 'Kênh', 'Trạng thái', 'Lượt xem', 'Tương tác', 'Nguồn', 'Thời điểm thu thập'],
      ...currentReport.top_posts.map((post, index) => [index + 1, post.title, post.campaign_tag, post.channels.join(', '), statusNames[post.status] || post.status, post.views, post.interactions, post.source, post.collected_at]),
    ];
    const csv = '\ufeff' + rows.map((row) => row.map(quote).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `mediahub-bao-cao-${currentReport.scope.start_date}-${currentReport.scope.end_date}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  form.addEventListener('submit', loadReport);
  $('refresh-report').addEventListener('click', loadReport);
  $('export-report').addEventListener('click', exportCsv);
  $('mobile-menu').addEventListener('click', () => {
    mobileOpen = !mobileOpen;
    $('sidebar').classList.toggle('is-open', mobileOpen);
    $('mobile-menu').setAttribute('aria-expanded', String(mobileOpen));
    $('sidebar-overlay').hidden = !mobileOpen;
  });
  $('sidebar-overlay').addEventListener('click', () => { mobileOpen = false; $('sidebar').classList.remove('is-open'); $('sidebar-overlay').hidden = true; $('mobile-menu').setAttribute('aria-expanded', 'false'); });
  loadReport();
})();
