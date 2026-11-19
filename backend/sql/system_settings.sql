-- UC03 – Cấu hình hệ thống (T0427C5)
-- Chạy file này một lần trên database của nhóm (MySQL, utf8mb4).

CREATE TABLE IF NOT EXISTS system_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(50) NOT NULL UNIQUE,
  setting_value VARCHAR(100) NOT NULL,
  updated_by INT NULL,
  updated_at DATETIME NULL,
  CONSTRAINT fk_system_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Giá trị mặc định (chạy lại nhiều lần không ghi đè giá trị đã chỉnh)
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
  ('timezone', 'Asia/Ho_Chi_Minh'),
  ('requireApproval', 'true'),
  ('manualPublishNeedsLink', 'true'),
  ('duplicateSlot', 'warn'),
  ('retryLimit', '3'),
  ('overdueMinutes', '60'),
  ('sessionMinutes', '30'),
  ('maxFailedLogins', '5'),
  ('lockMinutes', '15'),
  ('minPasswordLength', '8'),
  ('syncIntervalHours', '6'),
  ('maxFileMb', '100'),
  ('logRetentionMonths', '12'),
  ('apiConnect', 'false'),
  ('autoPost', 'false'),
  ('autoSync', 'false');
