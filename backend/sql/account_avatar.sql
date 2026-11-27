-- Run once against the project's shared database before starting the updated backend.
-- This additive schema change stores only the file path; image bytes remain under backend/uploads.
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL;
