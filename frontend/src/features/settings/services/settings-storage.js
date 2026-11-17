(() => {
  'use strict';

  const SETTINGS_KEY = 'mediahub.settings.v1';
  const HISTORY_KEY = 'mediahub.settings.history.v1';
  const HISTORY_LIMIT = 100;

  // Tạm thời lấy người dùng cố định. Thay bằng phiên đăng nhập thật khi UC01 có backend.
  const currentUser = Object.freeze({ name: 'Minh Quân', role: 'admin' });

  const timezones = Object.freeze({
    'Asia/Ho_Chi_Minh': 'Việt Nam (UTC+7)',
    'Asia/Bangkok': 'Bangkok (UTC+7)',
    'Asia/Singapore': 'Singapore (UTC+8)',
    'Asia/Tokyo': 'Tokyo (UTC+9)',
    UTC: 'UTC (UTC+0)',
  });
  const duplicateModes = Object.freeze({ warn: 'Cảnh báo, vẫn cho lưu', block: 'Chặn, không cho lưu' });

  const groups = Object.freeze({
    time: 'Múi giờ',
    status: 'Quy tắc trạng thái bài đăng',
    ops: 'Thông số vận hành',
    integration: 'Tích hợp mạng xã hội',
  });

  // Mỗi mục cấu hình khai báo một lần: dùng cho giao diện, kiểm tra giá trị và ghi lịch sử.
  const fields = Object.freeze({
    timezone: { group: 'time', type: 'select', options: timezones, default: 'Asia/Ho_Chi_Minh', label: 'Múi giờ hiển thị', hint: 'Hệ thống lưu thời gian dạng UTC và hiển thị theo múi giờ này (lịch đăng, báo cáo, nhật ký).' },
    requireApproval: { group: 'status', type: 'boolean', default: true, label: 'Bắt buộc duyệt trước khi lên lịch', hint: 'Nội dung phải qua Chờ duyệt, Đã duyệt thì mới được lên lịch.' },
    manualPublishNeedsLink: { group: 'status', type: 'boolean', default: true, label: 'Đăng thủ công cần đường dẫn bài gốc', hint: 'Chỉ ghi “Đã đăng” khi có đường dẫn bài gốc hoặc minh chứng.' },
    duplicateSlot: { group: 'status', type: 'select', options: duplicateModes, default: 'warn', label: 'Khi lịch trùng giờ trên cùng kênh', hint: 'Áp dụng lúc lên lịch đăng bài.' },
    retryLimit: { group: 'status', type: 'number', min: 0, max: 5, unit: 'lần', default: 3, label: 'Số lần thử lại khi đăng tự động thất bại', hint: 'Chỉ áp dụng khi bật đăng tự động. Vẫn lỗi thì ghi trạng thái “Thất bại”.' },
    overdueMinutes: { group: 'status', type: 'number', min: 5, max: 1440, unit: 'phút', default: 60, label: 'Đánh dấu bài quá lịch sau', hint: 'Bài chưa đăng sau thời gian này sẽ cảnh báo người phụ trách.' },
    sessionMinutes: { group: 'ops', type: 'number', min: 5, max: 480, unit: 'phút', default: 30, label: 'Phiên đăng nhập hết hạn sau', hint: 'Tự đăng xuất khi không thao tác. Mặc định 30 phút.' },
    maxFailedLogins: { group: 'ops', type: 'number', min: 3, max: 10, unit: 'lần', default: 5, label: 'Số lần nhập sai mật khẩu tối đa', hint: 'Quá số lần này thì khóa tài khoản tạm thời.' },
    lockMinutes: { group: 'ops', type: 'number', min: 1, max: 1440, unit: 'phút', default: 15, label: 'Thời gian khóa tạm', hint: 'Thời gian tài khoản bị khóa sau khi nhập sai quá số lần cho phép.' },
    minPasswordLength: { group: 'ops', type: 'number', min: 8, max: 32, unit: 'ký tự', default: 8, label: 'Độ dài mật khẩu tối thiểu', hint: 'Không thấp hơn 8 ký tự.' },
    syncIntervalHours: { group: 'ops', type: 'number', min: 1, max: 24, unit: 'giờ', default: 6, label: 'Chu kỳ cập nhật số liệu tự động', hint: 'Chỉ có tác dụng khi bật đồng bộ chỉ số tự động.' },
    maxFileMb: { group: 'ops', type: 'number', min: 1, max: 500, unit: 'MB', default: 100, label: 'Dung lượng tệp tải lên tối đa', hint: 'Áp dụng cho ảnh và video đính kèm nội dung.' },
    logRetentionMonths: { group: 'ops', type: 'number', min: 12, max: 60, unit: 'tháng', default: 12, label: 'Thời gian lưu nhật ký hoạt động', hint: 'Tối thiểu 12 tháng.' },
    apiConnect: { group: 'integration', type: 'boolean', default: false, label: 'Cho phép kết nối kênh qua API', hint: 'Cần ứng dụng được nền tảng phê duyệt. Tắt thì vẫn quản lý kênh thủ công.' },
    autoPost: { group: 'integration', type: 'boolean', default: false, label: 'Đăng bài tự động', hint: 'Hệ thống tự đăng đúng giờ đã lên lịch. Cần bật kết nối API.' },
    autoSync: { group: 'integration', type: 'boolean', default: false, label: 'Đồng bộ chỉ số tương tác tự động', hint: 'Cần bật kết nối API. Nếu tắt thì nhập số liệu thủ công.' },
  });

  const defaults = Object.freeze(Object.fromEntries(Object.entries(fields).map(([key, def]) => [key, def.default])));

  function isValidTimezone(value) {
    if (typeof value !== 'string' || !Object.hasOwn(timezones, value)) return false;
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  // Trả về { tênTrường: thôngBáoLỗi }. Rỗng nghĩa là hợp lệ.
  function validate(config) {
    const errors = {};
    for (const [key, def] of Object.entries(fields)) {
      const value = config?.[key];
      if (def.type === 'boolean') {
        if (typeof value !== 'boolean') errors[key] = 'Giá trị không hợp lệ.';
      } else if (def.type === 'number') {
        if (!Number.isInteger(value) || value < def.min || value > def.max) errors[key] = `Nhập số nguyên từ ${def.min} đến ${def.max} ${def.unit}.`;
      } else if (key === 'timezone') {
        if (!isValidTimezone(value)) errors[key] = 'Chọn một múi giờ có trong danh sách.';
      } else if (typeof value !== 'string' || !Object.hasOwn(def.options, value)) {
        errors[key] = 'Chọn một giá trị có trong danh sách.';
      }
    }
    if (config?.autoPost === true && config.apiConnect !== true && !errors.autoPost) errors.autoPost = 'Cần bật “Cho phép kết nối kênh qua API” trước khi bật đăng tự động.';
    if (config?.autoSync === true && config.apiConnect !== true && !errors.autoSync) errors.autoSync = 'Cần bật “Cho phép kết nối kênh qua API” trước khi bật đồng bộ tự động.';
    return errors;
  }

  function formatValue(key, value) {
    const def = fields[key];
    if (def.type === 'boolean') return value ? 'Bật' : 'Tắt';
    if (def.type === 'select') return def.options[value] ?? String(value);
    return `${value} ${def.unit}`;
  }

  // Danh sách các mục thay đổi giữa hai bản cấu hình.
  function diff(before, after) {
    return Object.keys(fields)
      .filter((key) => !Object.is(before[key], after[key]))
      .map((key) => ({ key, label: fields[key].label, from: formatValue(key, before[key]), to: formatValue(key, after[key]) }));
  }

  // Cảnh báo tác động trước khi lưu (UC03 – A2).
  function impacts(before, after) {
    const out = [];
    if (before.timezone !== after.timezone) out.push(`Giờ hiển thị của lịch đăng, báo cáo và nhật ký chuyển sang ${timezones[after.timezone]}. Giờ lưu (UTC) không đổi.`);
    if (before.requireApproval !== after.requireApproval) out.push(after.requireApproval ? 'Từ nay nội dung phải được duyệt trước khi lên lịch. Nội dung nháp đang có cần gửi duyệt.' : 'Nội dung có thể lên lịch mà không cần duyệt.');
    if (!before.autoPost && after.autoPost) out.push('Bài có lịch ở chế độ tự động sẽ được hệ thống đăng đúng giờ và không thu hồi được từ hệ thống.');
    if (before.autoPost && !after.autoPost) out.push('Tắt đăng tự động: các lịch tự động đang chờ sẽ chuyển sang đăng thủ công.');
    if (before.apiConnect && !after.apiConnect) out.push('Tắt kết nối API: các kênh đã kết nối ngừng đăng và đồng bộ tự động. Kênh vẫn quản lý thủ công được.');
    if (before.autoSync && !after.autoSync) out.push('Tắt đồng bộ tự động: số liệu tương tác cần nhập thủ công.');
    return out;
  }

  function canConfigure(user) {
    return Boolean(user) && user.role === 'admin';
  }

  function read(key) {
    const stored = localStorage.getItem(key);
    return stored === null ? null : JSON.parse(stored);
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function load() {
    try {
      const stored = read(SETTINGS_KEY);
      if (stored === null) return { config: { ...defaults }, warning: null };
      const config = { ...defaults, ...stored };
      if (stored && typeof stored === 'object' && !Array.isArray(stored) && Object.keys(validate(config)).length === 0) return { config, warning: null };
      return { config: { ...defaults }, warning: 'Cấu hình đã lưu không hợp lệ. Đang dùng giá trị mặc định.' };
    } catch {
      return { config: { ...defaults }, warning: 'Không đọc được cấu hình đã lưu. Đang dùng giá trị mặc định.' };
    }
  }

  function save(config) {
    return write(SETTINGS_KEY, config);
  }

  const isValidEntry = (entry) => entry && typeof entry.id === 'string' && typeof entry.by === 'string'
    && typeof entry.at === 'string' && !Number.isNaN(new Date(entry.at).getTime())
    && Array.isArray(entry.changes)
    && entry.changes.every((item) => item && ['label', 'from', 'to'].every((field) => typeof item[field] === 'string'));

  function loadHistory() {
    try {
      const stored = read(HISTORY_KEY);
      return Array.isArray(stored) ? stored.filter(isValidEntry).slice(0, HISTORY_LIMIT) : [];
    } catch {
      return [];
    }
  }

  // Ghi thêm một lần thay đổi: ai đổi, lúc nào (UTC), đổi gì. Mới nhất ở đầu danh sách.
  function appendHistory(history, entry) {
    const next = [entry, ...history].slice(0, HISTORY_LIMIT);
    return { history: next, saved: write(HISTORY_KEY, next) };
  }

  function formatDateTime(value, timeZone) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(date).map((part) => [part.type, part.value]));
      return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
    } catch {
      return '—';
    }
  }

  function offsetLabel(timeZone) {
    try {
      const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? '';
      return name === 'GMT' ? 'UTC+0' : name.replace('GMT', 'UTC');
    } catch {
      return '';
    }
  }

  window.MediaHubSettings = Object.freeze({
    currentUser, fields, groups, defaults, timezones,
    validate, diff, impacts, canConfigure, formatValue,
    load, save, loadHistory, appendHistory, formatDateTime, offsetLabel,
  });
})();
