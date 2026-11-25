(() => {
  'use strict';

  const DRAFTS_KEY = 'mediahub.composer.drafts.v1';
  const DATABASE_NAME = 'mediahub.composer.library.v1';
  const DATABASE_VERSION = 1;
  const MEDIA_STORE = 'media';
  const MAX_FILE_MB = 100;
  const MAX_MEDIA_PER_POST = 10;
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

  function readDrafts() {
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

  function loadDrafts(query = '') {
    const loaded = readDrafts();
    const normalizedQuery = normalize(query.trim());
    const drafts = loaded.drafts
      .filter((draft) => !normalizedQuery || normalize([
        draft.title,
        draft.contentText,
        draft.campaignTag,
        ...(Array.isArray(draft.campaignTags) ? draft.campaignTags : []),
        ...(Array.isArray(draft.channels) ? draft.channels : []),
      ].join(' ')).includes(normalizedQuery))
      .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    return { drafts, warning: loaded.warning };
  }

  function getDraft(id) {
    return readDrafts().drafts.find((draft) => draft.id === id) ?? null;
  }

  function saveDraft(draft) {
    const loaded = readDrafts();
    const drafts = loaded.drafts;
    const now = new Date().toISOString();
    const existingIndex = drafts.findIndex((item) => item.id === draft.id);
    const nextDraft = {
      ...draft,
      id: draft.id || makeId('draft'),
      createdAt: existingIndex >= 0 ? drafts[existingIndex].createdAt : now,
      updatedAt: now,
    };
    if (existingIndex >= 0) drafts[existingIndex] = nextDraft;
    else drafts.push(nextDraft);

    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      return { draft: nextDraft, saved: true };
    } catch {
      return { draft: nextDraft, saved: false };
    }
  }

  function deleteDraft(id) {
    const drafts = readDrafts().drafts.filter((draft) => draft.id !== id);
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      return true;
    } catch {
      return false;
    }
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
