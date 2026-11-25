-- Chạy một lần trên database MySQL của MediaHub trước khi dùng auth.
ALTER TABLE users
  ADD COLUMN full_name VARCHAR(80) NULL AFTER username;
