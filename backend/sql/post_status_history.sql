CREATE TABLE post_status_history (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    schedule_id INT NULL,
    from_status VARCHAR(30) NULL,
    to_status VARCHAR(30) NOT NULL,
    changed_by INT NULL,
    reason TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_post_status_history_post_id (post_id),
    INDEX ix_post_status_history_schedule_id (schedule_id),
    CONSTRAINT fk_post_status_history_post FOREIGN KEY (post_id) REFERENCES posts(id),
    CONSTRAINT fk_post_status_history_schedule FOREIGN KEY (schedule_id) REFERENCES schedules(id),
    CONSTRAINT fk_post_status_history_user FOREIGN KEY (changed_by) REFERENCES users(id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE schedules ADD COLUMN published_url VARCHAR(500) NULL;

-- Lưu ảnh chụp hiện trạng khi bật tính năng; không giả định đây là thời điểm đổi trạng thái thực tế.
INSERT INTO post_status_history (post_id, from_status, to_status, changed_by, reason, created_at)
SELECT id, NULL, COALESCE(status, 'draft'), created_by, 'Ghi nhận hiện trạng khi triển khai UC09', COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
FROM posts;

INSERT INTO post_status_history (post_id, schedule_id, from_status, to_status, changed_by, reason, created_at)
SELECT s.post_id, s.id, NULL, COALESCE(s.publish_status, 'pending'), NULL,
       'Ghi nhận hiện trạng khi triển khai UC09', COALESCE(s.created_at, CURRENT_TIMESTAMP)
FROM schedules s;
