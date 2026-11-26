-- Chạy một lần trên database MySQL của MediaHub trước khi dùng Composer.
ALTER TABLE posts
  ADD COLUMN composer_data JSON NULL AFTER campaign_tag;
