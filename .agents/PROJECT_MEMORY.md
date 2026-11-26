# Project Memory

## Backend integration

- Work on `feature/t0427c7-quan-ly-noi-dung-truyen-thong`; this branch was fast-forwarded to `origin/master` before implementation. Do not develop directly on `master`.
- FastAPI endpoints use synchronous handlers, SQLAlchemy ORM, Pydantic schemas, and existing unwrapped response shapes.
- `backend/database.py` loads `backend/.env` and connects through MySQL/PyMySQL. A read-only `SELECT 1` connection check succeeded on 2026-11-25.
- The connected database has `admin` and `employee` roles. Public registration always assigns `employee`; passwords are bcrypt hashes and login returns a JWT.
- `backend/sql/auth_composer.sql` adds nullable `users.full_name` and `posts.composer_data`; those two additive columns were applied to the connected database on 2026-11-25.
- Composer draft CRUD uses authenticated `/posts` endpoints and owner scoping. Existing browser drafts are imported once per account. Media files remain in IndexedDB.
- Keep `/auth/login`, `/auth/register`, `/auth/me`, and `/posts` response contracts compatible with the current frontend. The Composer publish/schedule dialog remains a demo flow.

## Verification notes

- JavaScript syntax checks and `git diff --check` pass.
- The auth plus post CRUD smoke flow passes on isolated in-memory SQLite.
- `backend/tests/test_settings_rules.py` passes. The existing `test_users_api.py` TestClient run hangs in this environment and was stopped; investigate Starlette/httpx compatibility before relying on that runner.
- Never record or display values from `backend/.env`.
- `backend/.env` is tracked by Git despite the ignore rule; review and rotate real credentials and remove the file from version control before sharing additional commits.
