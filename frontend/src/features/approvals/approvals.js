(() => {
  'use strict';

  const api = window.MediaHubApprovalsApi;
  const auth = window.MediaHubAuth;
  const STATUS_LABELS = {
    draft: 'Nháp',
    pending: 'Chờ duyệt',
    approved: 'Đã duyệt',
    rejected: 'Bị từ chối',
    published: 'Đã đăng',
  };
  const TABS = [
    { key: '', label: 'Tất cả' },
    { key: 'pending', label: STATUS_LABELS.pending },
    { key: 'draft', label: STATUS_LABELS.draft },
    { key: 'rejected', label: STATUS_LABELS.rejected },
    { key: 'approved', label: STATUS_LABELS.approved },
    { key: 'published', label: STATUS_LABELS.published },
  ];
  const HISTORY_LABELS = { submit: 'Gửi duyệt', approve: 'Đã duyệt', reject: 'Từ chối' };
  const SAFE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'UL', 'OL', 'LI']);
  const REASON_MIN = 5;
  const state = { me: null, filter: '', query: '', items: [], counts: {}, total: 0, selectedId: null, busy: false };
  let toastTimer;
  let searchTimer;
  let listRequest = 0;
  let detailRequest = 0;

  const byId = (id) => document.getElementById(id);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function notify(message, kind = 'success') {
    const toast = byId('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3800);
  }

  function errorMessage(error) {
    if (error.status === 0) return 'Không kết nối được máy chủ. Hãy kiểm tra backend đã chạy chưa.';
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
    const detail = error.detail;
    if (typeof detail === 'string') return detail;
    if (detail?.message) {
      const reasons = detail.errors ? Object.values(detail.errors).join(' ') : '';
      return reasons && reasons !== detail.message ? `${detail.message} ${reasons}` : detail.message;
    }
    if (Array.isArray(detail)) return 'Dữ liệu gửi lên chưa hợp lệ.';
    return `Có lỗi xảy ra (mã ${error.status}).`;
  }

  function formatTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function plainText(html) {
    const body = new DOMParser().parseFromString(String(html ?? ''), 'text/html').body;
    body.querySelectorAll('script, style').forEach((node) => node.remove());
    return (body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function appendSafeContent(source, target) {
    source.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(node.textContent ?? ''));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const name = node.tagName.toUpperCase();
      if (name === 'SCRIPT' || name === 'STYLE') return;
      if (!SAFE_TAGS.has(name)) {
        appendSafeContent(node, target);
        return;
      }
      const clean = document.createElement(name.toLowerCase());
      target.append(clean);
      appendSafeContent(node, clean);
    });
  }

  function statusBadge(status) {
    const badge = element('span', 'approval-status', STATUS_LABELS[status] ?? status);
    badge.dataset.status = status;
    return badge;
  }

  function showBanner(message) {
    byId('approval-banner-text').textContent = message;
    byId('approval-banner').hidden = !message;
  }

  function handleFailure(error, { toast = true } = {}) {
    if (error.status === 401) return;
    if (toast) notify(errorMessage(error), 'error');
    else showBanner(errorMessage(error));
  }

  function renderTabs() {
    const total = Object.values(state.counts).reduce((sum, value) => sum + value, 0);
    const tabs = TABS.map((tab) => {
      const button = element('button', 'approval-tab');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(state.filter === tab.key));
      button.classList.toggle('is-active', state.filter === tab.key);
      const count = tab.key ? state.counts[tab.key] ?? 0 : total;
      button.append(document.createTextNode(tab.label), element('span', 'approval-tab-count', String(count)));
      button.addEventListener('click', () => {
        if (state.filter === tab.key) return;
        state.filter = tab.key;
        state.selectedId = null;
        loadList();
      });
      return button;
    });
    byId('approval-tabs').replaceChildren(...tabs);
  }

  function renderList() {
    const list = byId('approval-list');
    const empty = byId('approval-empty');
    byId('list-summary').textContent = state.total ? `${state.total} nội dung` : '';
    list.replaceChildren(...state.items.map((item) => {
      const row = element('li', 'draft-row approval-row');
      row.classList.toggle('is-selected', item.id === state.selectedId);
      const open = element('button', 'draft-open');
      open.type = 'button';
      open.setAttribute('aria-current', String(item.id === state.selectedId));
      const preview = plainText(item.preview);
      open.append(
        element('strong', '', item.title || 'Chưa có tiêu đề'),
        element('span', '', preview || 'Chưa có nội dung'),
        element('small', '', [item.author_name, formatTime(item.updated_at)].filter(Boolean).join(' · ')),
      );
      open.addEventListener('click', () => selectItem(item.id));
      row.append(open, statusBadge(item.status));
      return row;
    }));
    empty.hidden = state.items.length > 0;
    empty.textContent = state.query
      ? 'Không có nội dung nào khớp từ khóa tìm kiếm.'
      : state.filter
        ? `Chưa có nội dung ở trạng thái “${STATUS_LABELS[state.filter]}”.`
        : 'Chưa có nội dung nào. Hãy tạo bài ở Thư viện nội dung.';
  }

  function renderDetailPlaceholder(message) {
    const body = byId('detail-body');
    body.replaceChildren(element('p', 'draft-empty', message));
  }

  function metaRow(label, value) {
    const row = element('div', 'approval-meta-row');
    row.append(element('dt', '', label), element('dd', '', value || '—'));
    return row;
  }

  function renderDetail(detail) {
    const body = byId('detail-body');
    const head = element('div', 'approval-detail-head');
    head.append(element('h2', 'approval-title', detail.title || 'Chưa có tiêu đề'), statusBadge(detail.status));

    const meta = element('dl', 'approval-meta');
    meta.append(
      metaRow('Người tạo', detail.author_name),
      metaRow('Thẻ chiến dịch', detail.campaign_tag ? `#${detail.campaign_tag.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean).join(' #')}` : ''),
      metaRow('Tạo lúc', formatTime(detail.created_at)),
      metaRow('Cập nhật', formatTime(detail.updated_at)),
    );
    if (detail.status === 'approved' || detail.status === 'published') meta.append(metaRow('Người duyệt', detail.approver_name));

    const content = element('div', 'approval-content');
    const parsed = new DOMParser().parseFromString(detail.content || '', 'text/html');
    appendSafeContent(parsed.body, content);
    if (!content.textContent.trim()) content.append(element('span', 'approval-muted', 'Nội dung chưa có phần văn bản.'));

    const nodes = [head, meta, element('p', 'field-label', 'Nội dung'), content];

    if (detail.status === 'rejected' && detail.reject_reason) {
      const reason = element('div', 'approval-reason');
      reason.append(element('strong', '', 'Lý do từ chối'), element('p', '', detail.reject_reason));
      nodes.push(reason);
    }

    nodes.push(element('p', 'field-label', 'Lịch sử duyệt'), renderHistory(detail.history));
    nodes.push(renderActions(detail));
    body.replaceChildren(...nodes);
  }

  function renderHistory(history) {
    if (!history.length) return element('p', 'approval-muted', 'Chưa có lịch sử duyệt.');
    const list = element('ol', 'approval-history');
    history.forEach((entry) => {
      const item = element('li', 'approval-history-item');
      item.dataset.event = entry.event;
      const title = element('strong', '', HISTORY_LABELS[entry.event] ?? entry.event);
      const by = element('span', '', [entry.username, formatTime(entry.created_at)].filter(Boolean).join(' · '));
      item.append(title, by);
      if (entry.event === 'reject' && entry.note) item.append(element('p', '', entry.note));
      list.append(item);
    });
    return list;
  }

  function renderActions(detail) {
    const actions = element('div', 'dialog-footer approval-actions');
    if (detail.can_review) {
      const reject = element('button', 'button button-secondary', 'Từ chối');
      reject.type = 'button';
      reject.addEventListener('click', () => openRejectDialog(detail));
      const approve = element('button', 'button button-primary', 'Duyệt nội dung');
      approve.type = 'button';
      approve.addEventListener('click', () => runAction(approve, () => api.approve(detail.id), 'Đã duyệt nội dung.'));
      actions.append(reject, approve);
    }
    if (detail.can_submit) {
      const label = detail.status === 'rejected' ? 'Gửi duyệt lại' : 'Gửi duyệt';
      const submit = element('button', 'button button-primary', label);
      submit.type = 'button';
      submit.addEventListener('click', () => runAction(submit, () => api.submit(detail.id), 'Đã gửi nội dung đi duyệt.'));
      actions.append(submit);
    }
    if (!actions.children.length) {
      actions.append(element('span', 'approval-muted', detail.status === 'pending' ? 'Đang chờ Người quản lý duyệt.' : 'Không có thao tác nào cho nội dung này.'));
    }
    return actions;
  }

  async function runAction(button, action, successMessage) {
    if (state.busy) return;
    state.busy = true;
    button.disabled = true;
    try {
      await action();
      notify(successMessage);
    } catch (error) {
      handleFailure(error);
    } finally {
      state.busy = false;
    }
    await loadList();
  }

  async function selectItem(id) {
    state.selectedId = id;
    renderList();
    const ticket = ++detailRequest;
    renderDetailPlaceholder('Đang tải chi tiết...');
    try {
      const detail = await api.detail(id);
      if (ticket !== detailRequest) return;
      renderDetail(detail);
    } catch (error) {
      if (ticket !== detailRequest) return;
      if (error.status === 404) {
        state.selectedId = null;
        renderDetailPlaceholder('Nội dung này không còn tồn tại hoặc bạn không có quyền xem.');
        await loadList();
        return;
      }
      if (error.status === 401) return;
      renderDetailPlaceholder(errorMessage(error));
      handleFailure(error, { toast: false });
    }
  }

  async function loadList() {
    const ticket = ++listRequest;
    try {
      const data = await api.list({ status: state.filter, q: state.query });
      if (ticket !== listRequest) return;
      showBanner('');
      state.items = data.items;
      state.counts = data.counts;
      state.total = data.total;
      renderTabs();
      if (!state.items.some((item) => item.id === state.selectedId)) {
        state.selectedId = state.items[0]?.id ?? null;
      }
      renderList();
      if (state.selectedId === null) {
        detailRequest += 1;
        renderDetailPlaceholder('Chọn một nội dung ở danh sách bên trái để xem chi tiết.');
        return;
      }
      await selectItem(state.selectedId);
    } catch (error) {
      if (ticket !== listRequest) return;
      handleFailure(error, { toast: false });
    }
  }

  function openRejectDialog(detail) {
    byId('reject-title').textContent = detail.title || 'Chưa có tiêu đề';
    byId('reject-form').dataset.postId = String(detail.id);
    byId('reject-reason').value = '';
    byId('reject-count').textContent = '0 / 200';
    const error = byId('reject-error');
    error.hidden = true;
    error.textContent = '';
    byId('reject-dialog').showModal();
    byId('reject-reason').focus();
  }

  async function submitReject(event) {
    event.preventDefault();
    const form = byId('reject-form');
    const reason = byId('reject-reason').value.replace(/\s+/g, ' ').trim();
    const error = byId('reject-error');
    if ([...reason].length < REASON_MIN) {
      error.textContent = `Vui lòng nhập lý do từ chối (ít nhất ${REASON_MIN} ký tự) để người tạo biết cần sửa gì.`;
      error.hidden = false;
      byId('reject-reason').focus();
      return;
    }
    if (state.busy) return;
    state.busy = true;
    byId('reject-confirm').disabled = true;
    try {
      await api.reject(Number(form.dataset.postId), reason);
      byId('reject-dialog').close();
      notify('Đã từ chối nội dung.');
    } catch (failure) {
      if (failure.status === 401) {
        byId('reject-dialog').close();
        return;
      } else if (failure.status === 422) {
        error.textContent = errorMessage(failure);
        error.hidden = false;
        return;
      } else {
        byId('reject-dialog').close();
        handleFailure(failure);
      }
    } finally {
      state.busy = false;
      byId('reject-confirm').disabled = false;
    }
    await loadList();
  }

  async function start() {
    showBanner('');
    if (!api.getToken()) return;
    try {
      state.me = await api.me();
    } catch (error) {
      if (error.status !== 401) {
        byId('reload-button').hidden = false;
        showBanner(errorMessage(error));
      }
      return;
    }
    if (!state.me.can_use) {
      byId('approval-view').hidden = true;
      showBanner('Vai trò của bạn không có quyền dùng chức năng duyệt nội dung.');
      return;
    }
    byId('approval-view').hidden = false;
    byId('reload-button').hidden = false;
    byId('approval-search').disabled = false;
    state.filter = state.me.can_review ? 'pending' : '';
    await loadList();
  }

  function closeSidebar() {
    byId('sidebar').classList.remove('is-open');
    byId('sidebar-overlay').hidden = true;
    byId('mobile-menu').setAttribute('aria-expanded', 'false');
  }

  function bindEvents() {

    byId('reject-form').addEventListener('submit', submitReject);
    byId('reject-reason').addEventListener('input', (event) => {
      byId('reject-count').textContent = `${[...event.target.value].length} / 200`;
      byId('reject-error').hidden = true;
    });
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => button.closest('dialog').close());
    });

    byId('approval-search').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = event.target.value.trim();
        state.selectedId = null;
        loadList();
      }, 300);
    });

    byId('reload-button').addEventListener('click', () => (state.me ? loadList() : start()));
    byId('banner-retry').addEventListener('click', start);

    byId('mobile-menu').addEventListener('click', () => {
      const isOpen = byId('sidebar').classList.toggle('is-open');
      byId('sidebar-overlay').hidden = !isOpen;
      byId('mobile-menu').setAttribute('aria-expanded', String(isOpen));
    });
    byId('sidebar-overlay').addEventListener('click', closeSidebar);
    document.querySelectorAll('[data-section]').forEach((button) => {
      button.addEventListener('click', () => notify(`Mục “${button.dataset.section}” chưa có trong bản demo.`, 'error'));
    });
  }

  bindEvents();
  start();
})();
