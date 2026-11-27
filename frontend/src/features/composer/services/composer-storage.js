(() => {
  'use strict';

  const DRAFTS_KEY = 'mediahub.composer.drafts.v1';
  const MIGRATION_KEY_PREFIX = 'mediahub.composer.migrated.v1.';
  const DATABASE_NAME = 'mediahub.composer.library.v1';
  const DATABASE_VERSION = 1;
  const MEDIA_STORE = 'media';
  const MAX_FILE_MB = 100;
  const MAX_MEDIA_PER_POST = 10;
  let legacyMigrationPromise;
  const extensionMimeTypes = Object.freeze({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  });
  let databasePromise;

  const mediaError = Object.freeze({
    unsupported: 'Trình duyệt này chưa hỗ trợ lưu media cục bộ. Hãy dùng phiên bản mới của Chrome, Edge, Firefox hoặc Safari.',
    invalidType: 'Định dạng chưa được hỗ trợ. Chọn ảnh JPG, PNG, WEBP hoặc video MP4, WEBM, MOV.',
    tooLarge: `Mỗi tệp phải nhỏ hơn ${MAX_FILE_MB} MB.`,
    tooMany: `Mỗi bài viết có thể đính kèm tối đa ${MAX_MEDIA_PER_POST} tệp trong bản demo.`,
    unreadable: 'Không đọc được tệp. Hãy thử chọn lại.',
  });

  function makeId(prefix) {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
  }

  function readLegacyDrafts() {
    try {
      const raw = localStorage.getItem(DRAFTS_KEY);
      if (!raw) return { drafts: [], warning: null };
      const drafts = JSON.parse(raw);
      if (!Array.isArray(drafts) || drafts.some((draft) => !draft || typeof draft.id !== 'string')) {
        return { drafts: [], warning: 'Danh sách bản nháp đã lưu không hợp lệ; đã mở danh sách trống.' };
      }
      return { drafts, warning: null };
    } catch {
      return { drafts: [], warning: 'Không đọc được bản nháp đã lưu; thay đổi mới chỉ giữ trong lần mở này.' };
    }
  }

  function toPostPayload(draft) {
    const tags = Array.isArray(draft.campaignTags)
      ? draft.campaignTags
      : String(draft.campaignTag ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
    const composerData = {
      title: draft.title ?? '',
      contentText: draft.contentText ?? '',
      campaignTags: tags,
      channels: Array.isArray(draft.channels) ? draft.channels : [],
      mediaIds: Array.isArray(draft.mediaIds) ? draft.mediaIds : [],
      publicImageUrl: String(draft.publicImageUrl ?? '').trim(),
      createdAt: draft.createdAt ?? null,
    };
    return {
      title: String(draft.title || '').trim() || 'Bản nháp chưa có tiêu đề',
      content: draft.contentHtml ?? '',
      campaign_tag: tags.join(', ').slice(0, 100) || null,
      composer_data: composerData,
    };
  }

  function fromPost(post) {
    const data = post.composer_data ?? {};
    const tags = Array.isArray(data.campaignTags)
      ? data.campaignTags
      : String(post.campaign_tag ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
    return {
      id: String(post.id),
      title: data.title ?? post.title,
      contentHtml: post.content ?? '',
      contentText: data.contentText ?? '',
      campaignTag: tags.join(', '),
      campaignTags: tags,
      channels: Array.isArray(data.channels) ? data.channels : [],
      mediaIds: Array.isArray(data.mediaIds) ? data.mediaIds : [],
      publicImageUrl: data.publicImageUrl ?? '',
      createdAt: data.createdAt ?? post.created_at,
      updatedAt: post.updated_at,
    };
  }

  async function apiRequest(path, options = {}) {
    const auth = window.MediaHubAuth;
    if (!auth?.getSession()) {
      throw Object.assign(new Error('Phiên đăng nhập đã hết hạn.'), { status: 401 });
    }
    return auth.request(path, options, true);
  }

  function migrateLegacyDrafts() {
    if (legacyMigrationPromise) return legacyMigrationPromise;
    legacyMigrationPromise = (async () => {
      const userId = window.MediaHubAuth.getSession().user.id;
      const migrationKey = `${MIGRATION_KEY_PREFIX}${userId}`;
      if (localStorage.getItem(migrationKey)) return;

      const loaded = readLegacyDrafts();
      if (loaded.warning) throw new Error(loaded.warning);
      for (const draft of loaded.drafts) {
        const draftKey = `${migrationKey}.${encodeURIComponent(draft.id)}`;
        if (localStorage.getItem(draftKey)) continue;
        const response = await apiRequest('/posts/', {
          method: 'POST',
          body: JSON.stringify(toPostPayload(draft)),
        });
        localStorage.setItem(draftKey, String(response.id));
      }
      localStorage.setItem(migrationKey, 'done');
    })().catch((error) => {
      legacyMigrationPromise = null;
      throw error;
    });
    return legacyMigrationPromise;
  }

  async function loadDrafts(query = '') {
    await migrateLegacyDrafts();
    const posts = await apiRequest('/posts/?mine=true');
    const normalizedQuery = normalize(query.trim());
    const allDrafts = posts.map(fromPost);
    const drafts = allDrafts.filter((draft) => !normalizedQuery || normalize([
      draft.title,
      draft.contentText,
      draft.campaignTag,
      ...draft.campaignTags,
      ...draft.channels,
    ].join(' ')).includes(normalizedQuery));
    return { drafts, total: allDrafts.length, warning: null };
  }

  async function getDraft(id) {
    const post = await apiRequest(`/posts/${encodeURIComponent(id)}`);
    return fromPost(post);
  }

  async function saveDraft(draft) {
    const path = draft.id ? `/posts/${encodeURIComponent(draft.id)}` : '/posts/';
    const response = await apiRequest(path, {
      method: draft.id ? 'PUT' : 'POST',
      body: JSON.stringify(toPostPayload(draft)),
    });
    return { draft: fromPost(response), saved: true };
  }

  async function deleteDraft(id) {
    await apiRequest(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  }

  function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }

  function extensionOf(fileName) {
    return String(fileName).split('.').pop().toLowerCase();
  }

  function validateMedia(file, currentCount = 0) {
    if (!file || typeof file.size !== 'number') return { valid: false, message: mediaError.unreadable };
    if (currentCount >= MAX_MEDIA_PER_POST) return { valid: false, message: mediaError.tooMany };
    if (file.size === 0) return { valid: false, message: mediaError.unreadable };
    if (file.size > MAX_FILE_MB * 1024 * 1024) return { valid: false, message: mediaError.tooLarge };
    const extensionType = extensionMimeTypes[extensionOf(file.name)];
    if (!extensionType) return { valid: false, message: mediaError.invalidType };
    const type = file.type || extensionType;
    if (type !== extensionType) {
      return { valid: false, message: mediaError.invalidType };
    }
    return { valid: true, message: '' };
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error(mediaError.unsupported));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(MEDIA_STORE)) {
          database.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(mediaError.unreadable));
      request.onblocked = () => reject(new Error('Đang có thẻ MediaHub cũ giữ thư viện media. Đóng thẻ đó rồi thử lại.'));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function addMedia(file) {
    const validation = validateMedia(file);
    if (!validation.valid) throw new Error(validation.message);
    const media = {
      id: makeId('media'),
      name: file.name,
      type: file.type || extensionMimeTypes[extensionOf(file.name)],
      size: file.size,
      createdAt: new Date().toISOString(),
      blob: file,
    };
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(MEDIA_STORE, 'readwrite');
      transaction.objectStore(MEDIA_STORE).add(media);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error(mediaError.unreadable));
      transaction.onabort = () => reject(transaction.error ?? new Error(mediaError.unreadable));
    });
    return { id: media.id, name: media.name, type: media.type, size: media.size, createdAt: media.createdAt };
  }

  async function getMedia(id) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error(mediaError.unreadable));
    });
  }

  async function listMedia() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE).getAll();
      request.onsuccess = () => resolve(request.result
        .map(({ id, name, type, size, createdAt }) => ({ id, name, type, size, createdAt }))
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)));
      request.onerror = () => reject(request.error ?? new Error(mediaError.unreadable));
    });
  }

  window.MediaHubComposerStore = Object.freeze({
    maxFileMb: MAX_FILE_MB,
    maxMediaPerPost: MAX_MEDIA_PER_POST,
    mediaError,
    loadDrafts,
    getDraft,
    saveDraft,
    deleteDraft,
    validateMedia,
    addMedia,
    getMedia,
    listMedia,
  });
})();
