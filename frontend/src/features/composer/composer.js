(() => {
  'use strict';

  const store = window.MediaHubComposerStore;
  const platformNames = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'UL', 'OL', 'LI']);
  const editor = document.getElementById('post-content');
  const titleInput = document.getElementById('post-title');
  const tagInput = document.getElementById('campaign-tag');
  const attachedMedia = [];
  const campaignTags = [];
  const objectUrls = new Map();
  let currentDraftId = null;
  let pendingDeleteId = null;
  let toastTimer;
  let uploadToLibrary = false;
  let isRestoring = false;
  let dirty = false;

  const byId = (id) => document.getElementById(id);
  const auth = window.MediaHubAuth;
  if (!auth?.getSession()) return;

  function showApiError(error) {
    if (error.status === 401) return;
    notify(error.message || 'Không thể kết nối với máy chủ.', 'error');
  }
  const selectedChannels = () => {
    const selected = document.querySelector('input[name="channel"]:checked');
    return selected ? [selected.value] : [];
  };
  const textFromHtml = (html) => {
    const container = document.createElement('div');
    container.innerHTML = sanitizeHtml(html);
    return (container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim();
  };

  function sanitizeHtml(html) {
    const parsed = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    const output = document.createElement('div');
    const copyChildren = (source, destination) => {
      [...source.childNodes].forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          destination.append(document.createTextNode(node.textContent ?? ''));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const name = node.tagName.toUpperCase();
        if (!allowedTags.has(name)) {
          copyChildren(node, destination);
          return;
        }
        const clean = document.createElement(name.toLowerCase());
        destination.append(clean);
        copyChildren(node, clean);
      });
    };
    copyChildren(parsed.body, output);
    return output.innerHTML;
  }

  function notify(message, kind = 'success') {
    const toast = byId('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3800);
  }

  function setDirty() {
    if (isRestoring) return;
    dirty = true;
    byId('save-state').textContent = 'Có thay đổi chưa lưu';
    byId('save-state').classList.add('is-dirty');
  }

  function setSavedState(message = 'Đã lưu bản nháp') {
    dirty = false;
    byId('save-state').textContent = message;
    byId('save-state').classList.remove('is-dirty');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function getObjectUrl(media) {
    if (objectUrls.has(media.id)) return objectUrls.get(media.id);
    if (!media.blob) return '';
    const url = URL.createObjectURL(media.blob);
    objectUrls.set(media.id, url);
    return url;
  }

  function releaseObjectUrl(id) {
    const url = objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }

  function mediaIcon(type) {
    return type?.startsWith('video/')
      ? '<svg class="icon" aria-hidden="true"><use href="#icon-video"/></svg>'
      : '<svg class="icon" aria-hidden="true"><use href="#icon-image"/></svg>';
  }

  function previewMediaMarkup(platform) {
    if (!attachedMedia.length) {
      return `<div class="preview-media-placeholder ${platform === 'tiktok' ? 'is-video-placeholder' : ''}"><span>YOUR NEXT<br>BIG IDEA.</span>${platform === 'tiktok' ? '<small>Video preview</small>' : ''}</div>`;
    }
    const items = platform === 'tiktok' ? attachedMedia.slice(0, 1) : attachedMedia.slice(0, 4);
    const gridClass = items.length > 1 ? `preview-media-grid has-${items.length}` : 'preview-media-grid';
    return `<div class="${gridClass}">${items.map((media) => {
      const source = escapeHtml(getObjectUrl(media));
      const alt = escapeHtml(media.name);
      return media.type?.startsWith('video/')
        ? `<div class="preview-media-item preview-video">${source ? `<video src="${source}" muted playsinline preload="metadata"></video>` : ''}<span class="video-mark">▶</span></div>`
        : `<div class="preview-media-item"><img src="${source}" alt="${alt}"></div>`;
    }).join('')}</div>`;
  }

  function previewText() {
    const safeHtml = sanitizeHtml(editor.innerHTML);
    return safeHtml || '<span class="preview-placeholder-text">Nội dung của bạn sẽ xuất hiện ở đây.</span>';
  }

  function normalizeCampaignTag(value) {
    return String(value ?? '').trim().replace(/^#+/, '').replace(/\s+/g, '-');
  }

  function campaignTagValues() {
    const pendingTags = tagInput.value.split(',').map(normalizeCampaignTag).filter(Boolean);
    return [...new Set([...campaignTags, ...pendingTags])];
  }

  function campaignHashtagMarkup() {
    return campaignTagValues()
      .map((tag) => `<span class="campaign-hashtag">#${escapeHtml(tag)}</span>`)
      .join(' ');
  }

  function renderCampaignTags() {
    const container = byId('campaign-tags');
    const chips = campaignTags.map((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'campaign-tag-chip';
      chip.setAttribute('aria-label', `Xóa hashtag #${tag}`);
      const label = document.createElement('span');
      label.textContent = `#${tag}`;
      const remove = document.createElement('span');
      remove.className = 'campaign-tag-remove';
      remove.setAttribute('aria-hidden', 'true');
      remove.textContent = '×';
      chip.append(label, remove);
      chip.addEventListener('click', () => {
        const index = campaignTags.indexOf(tag);
        if (index >= 0) campaignTags.splice(index, 1);
        renderCampaignTags();
        setDirty();
        updatePreview();
      });
      return chip;
    });
    container.replaceChildren(...chips);
  }

  function commitCampaignTagInput() {
    const tags = tagInput.value.split(',').map(normalizeCampaignTag).filter(Boolean);
    if (!tags.length) return;
    tags.forEach((tag) => {
      if (!campaignTags.some((current) => current.toLocaleLowerCase() === tag.toLocaleLowerCase())) campaignTags.push(tag);
    });
    tagInput.value = '';
    renderCampaignTags();
    setDirty();
    updatePreview();
  }

  function socialIcons() {
    return '<svg class="icon" aria-hidden="true"><use href="#icon-heart"/></svg><svg class="icon" aria-hidden="true"><use href="#icon-comment"/></svg><svg class="icon" aria-hidden="true"><use href="#icon-send"/></svg>';
  }

  function renderFacebookPreview() {
    const title = escapeHtml(titleInput.value.trim());
    const hashtag = campaignHashtagMarkup();
    return `<article class="social-post facebook-post" aria-label="Bản xem trước bài đăng Facebook">
      <header class="social-post-header"><span class="social-avatar brand-avatar">m.</span><div class="post-author"><strong>MediaHub Studio</strong><span>Vừa xong · <span aria-label="Công khai">◎</span></span></div><button class="post-more" type="button" aria-label="Tùy chọn">···</button></header>
      <div class="social-post-copy">${title ? `<strong class="post-title-preview">${title}</strong>` : ''}<div class="post-copy-content">${previewText()}</div>${hashtag}</div>
      <div class="social-post-media facebook-media">${previewMediaMarkup('facebook')}</div>
      <div class="reaction-summary"><span class="reaction-stack"><i>♥</i><i>👍</i></span><span>Bạn và những người khác</span><span class="reaction-comments">0 bình luận · 0 lượt chia sẻ</span></div>
      <div class="social-post-actions facebook-actions"><button type="button"><svg class="icon"><use href="#icon-heart"/></svg>Thích</button><button type="button"><svg class="icon"><use href="#icon-comment"/></svg>Bình luận</button><button type="button"><svg class="icon"><use href="#icon-share"/></svg>Chia sẻ</button></div>
    </article>`;
  }

  function renderInstagramPreview() {
    const title = escapeHtml(titleInput.value.trim());
    const caption = previewText();
    const hashtag = campaignHashtagMarkup();
    return `<article class="social-post instagram-post" aria-label="Bản xem trước bài đăng Instagram">
      <header class="social-post-header"><span class="instagram-avatar-ring"><span class="social-avatar instagram-avatar">m</span></span><div class="post-author"><strong>@mediahub.studio</strong><span>Được đề xuất cho bạn</span></div><button class="post-more" type="button" aria-label="Tùy chọn">···</button></header>
      <div class="social-post-media instagram-media">${previewMediaMarkup('instagram')}</div>
      <div class="instagram-post-controls"><div class="instagram-actions">${socialIcons()}</div><button type="button" class="bookmark-button" aria-label="Lưu bài viết"><svg class="icon"><use href="#icon-bookmark"/></svg></button></div>
      <div class="instagram-caption"><strong>mediahub.studio</strong>${title ? ` <b>${title}</b>` : ''} ${caption}${hashtag ? ` ${hashtag}` : ''}<span class="caption-more">... xem thêm</span></div>
      <p class="instagram-comments">Xem tất cả 0 bình luận</p><p class="instagram-date">VỪA XONG</p>
    </article>`;
  }

  function renderTikTokPreview() {
    const title = escapeHtml(titleInput.value.trim());
    const hashtag = campaignHashtagMarkup();
    return `<article class="social-post tiktok-post" aria-label="Bản xem trước video TikTok">
      <div class="tiktok-video-stage">${previewMediaMarkup('tiktok')}<div class="tiktok-top-label">Đang theo dõi　|　Dành cho bạn</div><div class="tiktok-video-copy"><strong>@mediahub.studio</strong><p>${title ? `${title} · ` : ''}${previewText()}${hashtag ? ` ${hashtag}` : ''}</p><span>♪ Âm thanh gốc - MediaHub Studio</span></div><div class="tiktok-action-rail"><span class="tiktok-profile-mark">m</span><span><svg class="icon"><use href="#icon-heart"/></svg><small>0</small></span><span><svg class="icon"><use href="#icon-comment"/></svg><small>0</small></span><span><svg class="icon"><use href="#icon-bookmark"/></svg><small>Lưu</small></span><span><svg class="icon"><use href="#icon-share"/></svg><small>Chia sẻ</small></span></div></div>
    </article>`;
  }

  function updatePreview() {
    const platform = selectedChannels()[0] ?? '';
    const stage = byId('preview-stage');
    const preview = byId('social-preview');
    const badge = byId('preview-platform-label');
    const platformIcon = byId('preview-platform-icon');
    stage.dataset.platform = platform || 'none';
    if (!platform) {
      preview.innerHTML = '<div class="preview-empty"><span class="preview-empty-icon">＋</span><strong>Chọn kênh để xem trước</strong><p>Chọn Facebook, Instagram hoặc TikTok ở mục Đăng lên.</p></div>';
      badge.textContent = 'Chưa chọn kênh';
      platformIcon.className = 'fa-brands';
      byId('preview-status').textContent = 'Chưa chọn kênh';
      return;
    }
    badge.textContent = platformNames[platform];
    platformIcon.className = `fa-brands fa-${platform}`;
    preview.innerHTML = platform === 'facebook'
      ? renderFacebookPreview()
      : platform === 'tiktok' ? renderTikTokPreview() : renderInstagramPreview();
    const hashtags = [...preview.querySelectorAll('.campaign-hashtag')];
    if (hashtags.length && platform === 'instagram') {
      const caption = preview.querySelector('.instagram-caption');
      const hashtagRow = document.createElement('div');
      hashtagRow.className = 'instagram-hashtag-row';
      hashtagRow.append(...hashtags);
      caption.after(hashtagRow);
    } else if (hashtags.length && platform === 'tiktok') {
      preview.querySelector('.tiktok-video-copy p').after(...hashtags);
    }
    byId('preview-status').textContent = 'Chưa xuất bản';
  }

  function updateCharacterCount() {
    const length = [...textFromHtml(editor.innerHTML)].length;
    byId('character-count').textContent = `${length.toLocaleString('vi-VN')} / 2.200`;
    byId('character-count').classList.toggle('is-over-limit', length > 2200);
  }

  function updateChannelChips() {
    document.querySelectorAll('.channel-chip').forEach((chip) => {
      chip.classList.toggle('is-selected', chip.querySelector('input').checked);
    });
    updatePreview();
  }

  function draftPayload() {
    const contentHtml = sanitizeHtml(editor.innerHTML);
    return {
      id: currentDraftId,
      title: titleInput.value.trim(),
      contentHtml,
      contentText: textFromHtml(contentHtml),
      campaignTag: campaignTagValues().join(', '),
      campaignTags: campaignTagValues(),
      channels: selectedChannels(),
      mediaIds: attachedMedia.map((media) => media.id),
      publicImageUrl: byId('publish-image-url')?.value.trim() || '',
    };
  }

  function validateForSave() {
    const draft = draftPayload();
    if (!draft.title && !draft.contentText && !draft.mediaIds.length && !draft.campaignTags.length) {
      titleInput.focus();
      notify('Hãy nhập tiêu đề, nội dung hoặc thêm media trước khi lưu.', 'error');
      return null;
    }
    if ([...draft.contentText].length > 2200) {
      editor.focus();
      notify('Nội dung đang vượt giới hạn 2.200 ký tự của bản demo.', 'error');
      return null;
    }
    return draft;
  }

  async function renderDraftCount() {
    try {
      const { total } = await store.loadDrafts();
      byId('draft-count').textContent = String(total).padStart(2, '0');
    } catch (error) {
      showApiError(error);
    }
  }

  async function saveDraft() {
    const payload = validateForSave();
    if (!payload) return false;
    byId('save-draft-bottom').disabled = true;
    try {
      const result = await store.saveDraft(payload);
      currentDraftId = result.draft.id;
      byId('new-post-button').hidden = false;
      byId('save-draft-bottom').textContent = 'Lưu thay đổi';
      byId('save-state').textContent = 'Đã lưu bản nháp';
      byId('save-state').classList.remove('is-dirty');
      dirty = false;
      renderDraftCount();
      if (byId('drafts-dialog').open) renderDraftList(byId('draft-library-search').value).catch(showApiError);
      notify('Đã lưu bản nháp trên máy chủ.', 'success');
      return true;
    } catch (error) {
      showApiError(error);
      return false;
    } finally {
      byId('save-draft-bottom').disabled = false;
    }
  }

  async function renderAttachedMedia() {
    const container = byId('attached-media');
    const cards = [];
    for (let index = 0; index < attachedMedia.length; index += 1) {
      const media = attachedMedia[index];
      const record = await store.getMedia(media.id).catch(() => null);
      if (record) {
        attachedMedia[index] = record;
        const source = getObjectUrl(record);
        const card = document.createElement('div');
        card.className = 'attached-media-item';
        card.dataset.mediaId = media.id;
        const visual = record.type?.startsWith('video/')
          ? Object.assign(document.createElement('div'), { className: 'attached-video-thumb', innerHTML: `${mediaIcon(record.type)}<span>VIDEO</span>` })
          : Object.assign(document.createElement('img'), { src: source, alt: record.name });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-media';
        remove.setAttribute('aria-label', `Gỡ ${record.name} khỏi bài viết`);
        remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-close"/></svg>';
        remove.addEventListener('click', () => {
          const index = attachedMedia.findIndex((item) => item.id === media.id);
          if (index >= 0) attachedMedia.splice(index, 1);
          renderAttachedMedia();
          setDirty();
          updatePreview();
        });
        const name = document.createElement('span');
        name.className = 'attached-media-name';
        name.textContent = record.name;
        card.append(visual, remove, name);
        cards.push(card);
      }
    }
    container.replaceChildren(...cards);
    byId('media-count').textContent = `${attachedMedia.length} tệp`;
    updatePreview();
  }

  async function addFiles(files, toLibrary = false) {
    const errorTarget = byId(toLibrary ? 'library-error' : 'media-error');
    errorTarget.hidden = true;
    const newIds = [];
    let firstError = '';
    for (const file of files) {
      const validation = store.validateMedia(file, toLibrary ? 0 : attachedMedia.length);
      if (!validation.valid) {
        firstError ||= validation.message;
        continue;
      }
      try {
        const metadata = await store.addMedia(file);
        newIds.push(metadata.id);
        if (!toLibrary) attachedMedia.push(metadata);
      } catch (error) {
        firstError ||= error.message || store.mediaError.unreadable;
      }
    }
    if (firstError) {
      errorTarget.textContent = firstError;
      errorTarget.hidden = false;
    }
    if (newIds.length) {
      if (toLibrary) {
        await renderLibrary(new Set([...attachedMedia.map((item) => item.id), ...newIds]));
        notify(`${newIds.length} tệp đã thêm vào thư viện.`, 'success');
      } else {
        setDirty();
        await renderAttachedMedia();
        notify(`${newIds.length} tệp đã được thêm vào bài viết.`, 'success');
      }
    }
  }

  function fileTypeLabel(type) {
    return type?.startsWith('video/') ? 'VIDEO' : 'IMAGE';
  }

  async function renderLibrary(preselected = new Set(attachedMedia.map((item) => item.id))) {
    const grid = byId('library-grid');
    byId('library-error').hidden = true;
    let media;
    try {
      media = await store.listMedia();
    } catch (error) {
      byId('library-error').textContent = error.message || store.mediaError.unreadable;
      byId('library-error').hidden = false;
      media = [];
    }
    const cards = [];
    for (const item of media) {
      const record = await store.getMedia(item.id).catch(() => null);
      if (!record) continue;
      const card = document.createElement('label');
      card.className = 'library-item';
      card.dataset.mediaId = item.id;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'library-select';
      checkbox.value = item.id;
      checkbox.checked = preselected.has(item.id);
      checkbox.setAttribute('aria-label', `Chọn ${item.name}`);
      const visual = document.createElement('div');
      visual.className = `library-visual ${item.type?.startsWith('video/') ? 'is-video' : ''}`;
      if (item.type?.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = getObjectUrl(record);
        img.alt = '';
        visual.append(img);
      } else {
        visual.innerHTML = `${mediaIcon(item.type)}<span>${fileTypeLabel(item.type)}</span>`;
      }
      const details = document.createElement('span');
      details.className = 'library-item-details';
      const name = document.createElement('strong');
      name.textContent = item.name;
      const size = document.createElement('small');
      size.textContent = `${fileTypeLabel(item.type)} · ${formatBytes(item.size)}`;
      details.append(name, size);
      card.append(checkbox, visual, details);
      cards.push(card);
    }
    grid.replaceChildren(...cards);
    byId('library-count').textContent = `${media.length} tệp`;
    byId('library-empty').hidden = media.length > 0;
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function openMediaLibrary() {
    renderLibrary().then(() => byId('media-dialog').showModal());
  }

  function setForm(draft) {
    isRestoring = true;
    currentDraftId = draft?.id ?? null;
    titleInput.value = draft?.title ?? '';
    editor.innerHTML = sanitizeHtml(draft?.contentHtml ?? '');
    tagInput.value = '';
    campaignTags.splice(0, campaignTags.length);
    const savedTags = Array.isArray(draft?.campaignTags)
      ? draft.campaignTags
      : String(draft?.campaignTag ?? '').split(',');
    savedTags.map(normalizeCampaignTag).filter(Boolean).forEach((tag) => {
      if (!campaignTags.some((current) => current.toLocaleLowerCase() === tag.toLocaleLowerCase())) campaignTags.push(tag);
    });
    renderCampaignTags();
    const savedChannel = draft?.channels?.[0] ?? 'instagram';
    document.querySelectorAll('input[name="channel"]').forEach((input) => { input.checked = input.value === savedChannel; });
    attachedMedia.splice(0, attachedMedia.length, ...(draft?.mediaIds ?? []).map((id) => ({ id })));
    byId('publish-image-url').value = draft?.publicImageUrl ?? '';
    byId('new-post-button').hidden = !currentDraftId;
    byId('save-draft-bottom').textContent = currentDraftId ? 'Lưu thay đổi' : 'Lưu nháp';
    setSavedState(currentDraftId ? 'Đang chỉnh sửa bản nháp' : 'Bản nháp mới');
    updateCharacterCount();
    updateChannelChips();
    renderAttachedMedia().then(() => { isRestoring = false; });
  }

  async function renderDraftList(query = '') {
    const { drafts, total, warning } = await store.loadDrafts(query);
    const list = byId('draft-list');
    const cards = drafts.map((draft) => {
      const card = document.createElement('article');
      card.className = 'draft-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'draft-open';
      open.dataset.openDraft = draft.id;
      const title = document.createElement('strong');
      title.textContent = draft.title || 'Bản nháp chưa có tiêu đề';
      const preview = document.createElement('span');
      preview.textContent = draft.contentText || 'Chưa có nội dung';
      const metadata = document.createElement('small');
      const channelLabel = (draft.channels ?? []).map((channel) => platformNames[channel] ?? channel).join(' · ') || 'Chưa chọn kênh';
      metadata.textContent = `${channelLabel} · ${formatDate(draft.updatedAt)}`;
      open.append(title, preview, metadata);
      const tag = document.createElement('span');
      tag.className = 'draft-tag';
      tag.textContent = draft.campaignTag ? `#${draft.campaignTag}` : '';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button draft-delete';
      remove.dataset.deleteDraft = draft.id;
      remove.setAttribute('aria-label', `Xóa ${draft.title || 'bản nháp'}`);
      remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-close"/></svg>';
      card.append(open, tag, remove);
      return card;
    });
    list.replaceChildren(...cards);
    byId('draft-empty').hidden = drafts.length > 0;
    byId('draft-empty').textContent = warning || (query ? 'Không tìm thấy bản nháp phù hợp.' : 'Chưa có bản nháp.');
    byId('draft-count').textContent = String(total).padStart(2, '0');
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return 'Vừa xong';
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  async function openDrafts(query = '') {
    const dialog = byId('drafts-dialog');
    byId('draft-library-search').value = query;
    try {
      await renderDraftList(query);
    } catch (error) {
      showApiError(error);
      return;
    }
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => byId('draft-library-search').focus());
  }

  function newPost() {
    setForm(null);
    byId('draft-search').value = '';
    titleInput.focus();
  }

  function requestDraftDelete(id) {
    pendingDeleteId = id;
    byId('drafts-dialog').close();
    setTimeout(() => byId('delete-dialog').showModal(), 0);
  }

  function closeSidebar() {
    byId('sidebar').classList.remove('is-open');
    byId('sidebar-overlay').hidden = true;
    byId('mobile-menu').setAttribute('aria-expanded', 'false');
  }

  function setupSidebar() {
    byId('mobile-menu').addEventListener('click', () => {
      const isOpen = byId('sidebar').classList.toggle('is-open');
      byId('sidebar-overlay').hidden = !isOpen;
      byId('mobile-menu').setAttribute('aria-expanded', String(isOpen));
    });
    byId('sidebar-overlay').addEventListener('click', closeSidebar);
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => button.closest('dialog')?.close());
    });
  }

  function setupEditor() {
    [editor, titleInput, tagInput].forEach((element) => element.addEventListener('input', () => {
      setDirty();
      updatePreview();
      updateCharacterCount();
    }));
    tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        commitCampaignTagInput();
      }
    });
    tagInput.addEventListener('blur', commitCampaignTagInput);
    document.querySelectorAll('.rich-toolbar [data-command]').forEach((button) => {
      button.addEventListener('click', () => {
        editor.focus();
        document.execCommand(button.dataset.command, false);
        setDirty();
        updatePreview();
        updateCharacterCount();
      });
    });
    byId('insert-emoji').addEventListener('click', () => {
      editor.focus();
      document.execCommand('insertText', false, ' ✨');
      setDirty();
      updatePreview();
      updateCharacterCount();
    });
    document.querySelectorAll('input[name="channel"]').forEach((input) => {
      input.addEventListener('change', () => {
        updateChannelChips();
        setDirty();
      });
    });
  }

  function setupMedia() {
    byId('library-upload').addEventListener('click', () => {
      uploadToLibrary = true;
      byId('media-input').click();
    });
    byId('open-media-library').addEventListener('click', openMediaLibrary);
    byId('media-input').addEventListener('change', async (event) => {
      const files = [...event.currentTarget.files];
      if (!files.length) return;
      await addFiles(files, uploadToLibrary);
      event.currentTarget.value = '';
    });
    byId('attach-media').addEventListener('click', async () => {
      const picked = [...document.querySelectorAll('.library-select:checked')].map((input) => input.value);
      const ids = [...new Set([...attachedMedia.map((media) => media.id), ...picked])];
      if (ids.length > store.maxMediaPerPost) {
        byId('library-error').textContent = store.mediaError.tooMany;
        byId('library-error').hidden = false;
        return;
      }
      attachedMedia.splice(0, attachedMedia.length, ...ids.map((id) => ({ id })));
      await renderAttachedMedia();
      setDirty();
      byId('media-dialog').close();
    });
  }

  function setupDrafts() {
    byId('open-drafts').addEventListener('click', () => openDrafts());
    byId('draft-search').addEventListener('click', () => openDrafts(byId('draft-search').value));
    byId('draft-search').addEventListener('input', () => openDrafts(byId('draft-search').value));
    byId('draft-library-search').addEventListener('input', (event) => renderDraftList(event.currentTarget.value).catch(showApiError));
    byId('draft-list').addEventListener('click', async (event) => {
      const deleteButton = event.target.closest('[data-delete-draft]');
      if (deleteButton) {
        requestDraftDelete(deleteButton.dataset.deleteDraft);
        return;
      }
      const openButton = event.target.closest('[data-open-draft]');
      if (openButton) {
        try {
          const draft = await store.getDraft(openButton.dataset.openDraft);
          if (!draft) return;
          setForm(draft);
          byId('drafts-dialog').close();
          byId('draft-search').value = '';
          notify('Đã mở bản nháp để chỉnh sửa.');
        } catch (error) { showApiError(error); }
      }
    });
    byId('confirm-delete-draft').addEventListener('click', async () => {
      try {
        await store.deleteDraft(pendingDeleteId);
        if (currentDraftId === pendingDeleteId) newPost();
        pendingDeleteId = null;
        byId('delete-dialog').close();
        renderDraftCount();
        if (byId('drafts-dialog').open) renderDraftList(byId('draft-library-search').value).catch(showApiError);
        notify('Đã xóa bản nháp.', 'success');
      } catch (error) { showApiError(error); }
    });
    byId('new-post-button').addEventListener('click', newPost);
  }

  function setupActions() {
    byId('save-draft-bottom').addEventListener('click', saveDraft);
    byId('schedule-post').addEventListener('click', () => {
      const payload = validateForSave();
      if (!payload) return;
      if (!payload.channels.length) {
        notify('Chọn ít nhất một kênh trước khi lên lịch.', 'error');
        document.querySelector('.channel-field').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const scheduledDefault = new Date(Date.now() + 60 * 60 * 1000);
      scheduledDefault.setMinutes(Math.ceil(scheduledDefault.getMinutes() / 5) * 5, 0, 0);
      const localDate = new Date(scheduledDefault.getTime() - scheduledDefault.getTimezoneOffset() * 60000);
      byId('scheduled-time').value = localDate.toISOString().slice(0, 16);
      byId('publish-result').hidden = true;
      byId('publish-dialog').showModal();
    });
    byId('save-from-publish').addEventListener('click', () => {
      byId('publish-dialog').close();
      saveDraft();
    });
    byId('schedule-submit').addEventListener('click', async () => {
      const payload = validateForSave();
      if (!payload) return;
      const channelName = payload.channels[0];
      if (!['facebook', 'instagram'].includes(channelName)) {
        notify('Hiện chỉ hỗ trợ lên lịch Facebook và Instagram.', 'error');
        return;
      }
      const scheduledValue = byId('scheduled-time').value;
      const scheduledDate = new Date(scheduledValue);
      if (!scheduledValue || Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        byId('scheduled-time').focus();
        notify('Chọn ngày giờ đăng trong tương lai.', 'error');
        return;
      }
      if (channelName === 'instagram' && !byId('publish-image-url').value.trim()) {
        byId('publish-image-url').focus();
        notify('Instagram cần URL ảnh công khai để lên lịch.', 'error');
        return;
      }

      const button = byId('schedule-submit');
      const resultBox = byId('publish-result');
      button.disabled = true;
      resultBox.hidden = false;
      resultBox.textContent = 'Đang lưu bài và lịch đăng…';
      try {
        const saved = await store.saveDraft(payload);
        currentDraftId = saved.draft.id;
        byId('new-post-button').hidden = false;
        const post = await auth.request(`/posts/${encodeURIComponent(currentDraftId)}`, {}, true);
        if (post.status === 'published') throw new Error('Bài này đã được đăng, không thể đặt lịch lại.');

        const planner = await auth.request('/planner/', {}, true);
        const channelAliases = {
          facebook: ['facebook', 'fb', 'facebook_page'],
          instagram: ['instagram', 'ig', 'instagram_business'],
        };
        const channel = (planner.channels || []).find((item) => channelAliases[channelName].includes(String(item.channel_type).trim().toLowerCase()));
        if (!channel) throw new Error(`Chưa có kênh ${platformNames[channelName]} đang hoạt động trong danh sách kênh.`);

        await auth.request('/planner/', {
          method: 'POST',
          body: JSON.stringify({ post_id: Number(currentDraftId), channel_id: channel.id, scheduled_time: scheduledDate.toISOString() }),
        }, true);

        let approvalMessage = 'Lịch đã được lưu; hệ thống sẽ đợi đến giờ đã chọn.';
        if (['draft', 'rejected'].includes(post.status)) {
          await auth.request(`/approvals/${encodeURIComponent(currentDraftId)}/submit`, { method: 'POST' }, true);
          approvalMessage = 'Đã lưu lịch và gửi bài chờ duyệt. Bài sẽ được đăng khi đã duyệt và đến giờ.';
        } else if (post.status === 'pending') {
          approvalMessage = 'Lịch đã lưu. Bài đang chờ duyệt; hệ thống sẽ đăng khi đã duyệt và đến giờ.';
        }
        resultBox.textContent = approvalMessage;
        notify('Đã lưu lịch đăng.', 'success');
        setSavedState('Đã lưu lịch đăng');
        dirty = false;
        renderDraftCount();
      } catch (error) {
        resultBox.textContent = error.message || 'Không thể lưu lịch đăng.';
        resultBox.hidden = false;
        if (error.status === 401) showApiError(error);
      } finally {
        button.disabled = false;
      }
    });
    byId('publish-now').addEventListener('click', async () => {
      const payload = validateForSave();
      if (!payload) return;
      if (payload.channels.some((channel) => !['facebook', 'instagram'].includes(channel))) {
        notify('Hiện chỉ hỗ trợ đăng trực tiếp lên Facebook và Instagram. Bạn vẫn có thể lưu kênh khác thành bản nháp.', 'error');
        return;
      }
      const button = byId('publish-now');
      const resultBox = byId('publish-result');
      button.disabled = true;
      resultBox.hidden = false;
      resultBox.textContent = 'Đang lưu và gửi yêu cầu đăng…';
      try {
        const saved = await store.saveDraft(payload);
        currentDraftId = saved.draft.id;
        byId('new-post-button').hidden = false;
        const result = await auth.request(`/posts/${encodeURIComponent(currentDraftId)}/publish`, {
          method: 'POST',
          body: JSON.stringify({
            channels: payload.channels.filter((channel) => ['facebook', 'instagram'].includes(channel)),
            image_url: byId('publish-image-url').value.trim() || null,
          }),
        }, true);
        const failed = (result.results || []).filter((item) => item.status === 'failed');
        if (result.status === 'published') {
          resultBox.textContent = 'Đã đăng thành công lên tất cả kênh đã chọn.';
          notify('Đã đăng bài thành công.', 'success');
          setSavedState('Đã đăng');
        } else {
          resultBox.textContent = failed.map((item) => `${platformNames[item.channel] || item.channel}: ${item.error}`).join(' · ') || 'Chưa đăng được bài.';
          notify('Không đăng được lên tất cả kênh. Xem chi tiết trong hộp thoại.', 'error');
        }
        renderDraftCount();
      } catch (error) {
        resultBox.textContent = error.message || 'Không thể đăng bài.';
        resultBox.hidden = false;
        if (error.status === 401) showApiError(error);
      } finally {
        button.disabled = false;
      }
    });
    byId('draft-search').addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && byId('drafts-dialog').open) byId('drafts-dialog').close();
    });
    byId('drafts-dialog').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    });
    byId('media-dialog').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    });
    window.addEventListener('beforeunload', (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('pagehide', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
  }

  setupSidebar();
  setupEditor();
  setupMedia();
  setupDrafts();
  setupActions();
  setForm(null);
  renderDraftCount();
})();
