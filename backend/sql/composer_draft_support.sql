-- Safe, re-runnable schema support for Composer, post tracking, and reports.
-- Run this against the selected MediaHub database before using these features.

-- Composer persists structured fields as JSON.
SELECT COUNT(*) INTO @composer_data_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'posts'
  AND COLUMN_NAME = 'composer_data';

SET @composer_data_ddl = IF(
  @composer_data_exists = 0,
  'ALTER TABLE posts ADD COLUMN composer_data JSON NULL AFTER campaign_tag',
  'SELECT ''posts.composer_data already exists'''
);
PREPARE composer_data_stmt FROM @composer_data_ddl;
EXECUTE composer_data_stmt;
DEALLOCATE PREPARE composer_data_stmt;

-- Soft deletion keeps post history intact while removing deleted drafts from views.
SELECT COUNT(*) INTO @posts_deleted_at_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'posts'
  AND COLUMN_NAME = 'deleted_at';

SET @posts_deleted_at_ddl = IF(
  @posts_deleted_at_exists = 0,
  'ALTER TABLE posts ADD COLUMN deleted_at DATETIME NULL',
  'SELECT ''posts.deleted_at already exists'''
);
PREPARE posts_deleted_at_stmt FROM @posts_deleted_at_ddl;
EXECUTE posts_deleted_at_stmt;
DEALLOCATE PREPARE posts_deleted_at_stmt;

SELECT COUNT(*) INTO @posts_deleted_at_index_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'posts'
  AND INDEX_NAME = 'ix_posts_deleted_at';

SET @posts_deleted_at_index_ddl = IF(
  @posts_deleted_at_index_exists = 0,
  'CREATE INDEX ix_posts_deleted_at ON posts (deleted_at)',
  'SELECT ''posts.ix_posts_deleted_at already exists'''
);
PREPARE posts_deleted_at_index_stmt FROM @posts_deleted_at_index_ddl;
EXECUTE posts_deleted_at_index_stmt;
DEALLOCATE PREPARE posts_deleted_at_index_stmt;

-- ORM Schedule reads this optional link in reports and post status views.
SELECT COUNT(*) INTO @schedules_published_url_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'schedules'
  AND COLUMN_NAME = 'published_url';

SET @schedules_published_url_ddl = IF(
  @schedules_published_url_exists = 0,
  'ALTER TABLE schedules ADD COLUMN published_url VARCHAR(500) NULL',
  'SELECT ''schedules.published_url already exists'''
);
PREPARE schedules_published_url_stmt FROM @schedules_published_url_ddl;
EXECUTE schedules_published_url_stmt;
DEALLOCATE PREPARE schedules_published_url_stmt;

-- Every new post records its initial status in the append-only history table.
CREATE TABLE IF NOT EXISTS post_status_history (
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
