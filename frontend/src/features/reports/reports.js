(() => {
  'use strict';

  const auth = window.MediaHubAuth;
  const API_BASE = (auth?.API_BASE_URL || window.MEDIAHUB_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const statusLabels = {
    draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt',
    rejected: 'Từ chối', published: 'Đã đăng'
  };
  const byId = (id) => document.getElementById(id);
  const filters = () => {
    const params = new URLSearchParams();
    const from = byId('date-from').value;
    const to = byId('date-to').value;
    const status = byId('report-status').value;
    const tag = byId('campaign-tag').value.trim();
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    if (status) params.set('status', status);
    if (tag) params.set('campaign_tag', tag);
    return params;
  };

  function session() {
    return auth?.getSession?.() || null;
  }

  function token() {
    return session()?.access_token || null;
  }

  function renderUser() {
    const current = session()?.user;
    const name = current?.name || current?.email || 'Chưa đăng nhập';
    const initial = name.trim().slice(-1).toLocaleUpperCase('vi-VN') || '?';
    const nameElement = byId('user-name');
    const initialElement = byId('user-initial');
    if (nameElement) nameElement.textContent = name;
    if (initialElement) initialElement.textContent = initial;
    const profileInitials = byId('profile-initials');
    const profileRole = byId('profile-role');
    if (profileInitials) profileInitials.textContent = name.trim().split(/\s+/).slice(-2).map((word) => word[0]).join('').toLocaleUpperCase('vi-VN') || '?';
    if (profileRole) profileRole.textContent = current?.role_name || current?.role || 'Tài khoản';
  }

  function showAlert(message, kind = 'error') {
    const alert = byId('report-alert');
    alert.textContent = message;
    alert.dataset.kind = kind;
    alert.hidden = !message;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function formatDate(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
  }

  function number(value) {
    return Number(value || 0).toLocaleString('vi-VN');
  }

  async function getPreview() {
    const bearer = token();
    if (!bearer) {
      showAlert('Bạn chưa đăng nhập. Vui lòng đăng nhập để xem báo cáo.', 'error');
      return null;
    }
    const response = await fetch(`${API_BASE}/reports/preview?${filters()}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}` }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.detail || `Lỗi tải báo cáo (${response.status})`);
    return data;
  }

  const compact = (value) => {
    const n = Number(value || 0);
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return String(n);
  };
  const channelStyle = {
    facebook: ['Facebook', '#4f74d0'],
    instagram: ['Instagram', '#c06ab0'],
    tiktok: ['TikTok', '#151e1a']
  };
  const channelName = (key) => channelStyle[key]?.[0] || key.charAt(0).toLocaleUpperCase('vi-VN') + key.slice(1);
  const fallbackColors = ['#c3f36b', '#e0a43c', '#7e8a83'];

  function renderReach(totals, rows) {
    byId('reach-total').textContent = Number(totals.views || 0).toLocaleString('en-US');
    const interactions = Number(totals.likes || 0) + Number(totals.comments || 0) + Number(totals.shares || 0);
    const rate = totals.views ? (interactions / totals.views) * 100 : 0;
    byId('reach-rate').textContent = `${rate.toFixed(1)}%`;
    const recent = rows.slice(0, 8).reverse();
    const peak = Math.max(1, ...recent.map((row) => Number(row.views || 0)));
    byId('reach-bars').replaceChildren(...recent.map((row, index) => {
      const bar = document.createElement('span');
      bar.className = `insight-bar${index === recent.length - 1 ? ' is-latest' : ''}`;
      bar.style.height = `${Math.max(12, Math.round((Number(row.views || 0) / peak) * 100))}%`;
      bar.title = `${row.title || `Bài viết #${row.post_id}`}: ${number(row.views)} lượt xem`;
      return bar;
    }));
  }

  function renderSplit(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      const keys = row.channels?.length ? row.channels : ['unscheduled'];
      keys.forEach((key) => groups.set(key, (groups.get(key) || 0) + Number(row.views || 0) / keys.length));
    });
    const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((sum, item) => sum + item[1], 0);
    let spare = 0;
    byId('split-list').replaceChildren(...sorted.map(([key, value]) => {
      const percent = total ? Math.round((value / total) * 100) : 0;
      const known = channelStyle[key];
      const color = known ? known[1] : fallbackColors[spare++ % fallbackColors.length];
      const name = key === 'unscheduled' ? 'Chưa lên lịch' : channelName(key);
      const item = document.createElement('div');
      item.className = 'split-item';
      item.innerHTML = `<div class="split-head"><span>${escapeHtml(name)}</span><strong>${percent}%</strong></div><div class="split-track"><span style="width:${percent}%;background:${color}"></span></div>`;
      return item;
    }));
  }

  function renderTop(rows) {
    const top = [...rows].sort((a, b) => Number(b.views || 0) - Number(a.views || 0)).slice(0, 5);
    byId('top-list').innerHTML = top.map((row, index) => `<li class="top-item"><span class="top-rank">${String(index + 1).padStart(2, '0')}</span><strong class="top-title">${escapeHtml(row.title || `Bài viết #${row.post_id}`)}</strong><span class="top-tag">${escapeHtml(row.channels?.length ? row.channels.map(channelName).join(', ') : (row.campaign_tag || statusLabels[row.status] || '—'))}</span><span class="top-views">${compact(row.views)}</span></li>`).join('');
    byId('report-empty').hidden = rows.length !== 0;
  }

  function clearReport() {
    byId('reach-total').textContent = '0';
    byId('reach-rate').textContent = '0%';
    byId('reach-bars').replaceChildren();
    byId('split-list').replaceChildren();
    byId('top-list').replaceChildren();
    byId('report-empty').hidden = false;
  }

  async function loadReport() {
    showAlert('');
    try {
      const data = await getPreview();
      if (!data) { clearReport(); return; }
      renderReach(data.totals, data.rows);
      renderSplit(data.rows);
      renderTop(data.rows);
    } catch (error) {
      clearReport();
      showAlert(error.message);
    }
  }

  async function exportFile(kind) {
    const button = byId(kind === 'pdf' ? 'export-pdf' : 'export-excel');
    button.disabled = true;
    showAlert('');
    try {
      const bearer = token();
      if (!bearer) throw new Error('Bạn chưa đăng nhập. Vui lòng đăng nhập trước khi xuất báo cáo.');
      const response = await fetch(`${API_BASE}/reports/export/${kind}?${filters()}`, {
        headers: { Authorization: `Bearer ${bearer}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || `Xuất file thất bại (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || (kind === 'pdf' ? 'RP03_bao_cao.pdf' : 'RP03_bao_cao.xlsx');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showAlert(`Đã xuất ${kind.toUpperCase()} thành công.`, 'success');
    } catch (error) {
      showAlert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  byId('apply-report-filters').addEventListener('click', loadReport);
  const exportToggle = byId('export-toggle');
  const exportOptions = byId('export-options');
  const setExportMenu = (open) => { exportOptions.hidden = !open; exportToggle.setAttribute('aria-expanded', String(open)); };
  exportToggle.addEventListener('click', (event) => { event.stopPropagation(); setExportMenu(exportOptions.hidden); });
  document.addEventListener('click', () => setExportMenu(false));
  byId('export-pdf').addEventListener('click', () => { setExportMenu(false); exportFile('pdf'); });
  byId('export-excel').addEventListener('click', () => { setExportMenu(false); exportFile('excel'); });

  byId('mobile-menu').addEventListener('click', () => {
    const sidebar = byId('sidebar');
    const overlay = byId('sidebar-overlay');
    const isOpen = sidebar.classList.toggle('is-open');
    overlay.hidden = !isOpen;
    byId('mobile-menu').setAttribute('aria-expanded', String(isOpen));
  });
  byId('sidebar-overlay').addEventListener('click', () => {
    byId('sidebar').classList.remove('is-open');
    byId('sidebar-overlay').hidden = true;
    byId('mobile-menu').setAttribute('aria-expanded', 'false');
  });
  byId('logout-button').addEventListener('click', () => {
    auth?.endSession?.();
    window.location.href = './login.html';
  });

  renderUser();
  loadReport();
})();
