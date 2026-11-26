# Project Memory

## UC09: Post status and activity history
- The tracking page lives at `frontend/src/app/post_status.html`; Composer remains the content authoring surface.
- Keep approval workflow state (`posts.status`) separate from per-channel publishing state (`schedules.publish_status`). A single post can have different publish outcomes by channel.
- `post_status_history` is append-only and stores each status transition, actor, schedule/channel association, reason, and timestamp. See `backend/sql/post_status_history.sql` for the one-time schema and current-state snapshot migration; run it once before using UC09 on the existing MySQL database.
- `schedules.published_url` stores an optional link to the live platform post. Cancelling a pending schedule is a soft cancellation so the schedule and its history remain available.
- Hard deletion of a post with status history is rejected to protect the audit trail; pending schedules are cancelled instead of physically deleted.
- The UC09 API is mounted at `/post-status`; publication status updates continue through `PATCH /schedules/{schedule_id}/status` with allowed transitions and audit records.
- Activity events for content creation, approval, schedule/publication changes, and user permission changes are written to `activity_logs`.
- Legacy `PATCH /posts/{id}/status` also appends a history row when it changes approval state; do not add another direct status mutation path without the same append-only audit behavior.
- UI uses the Composer's Manrope font and existing green/sage palette from `frontend/src/styles/style.css` and `frontend/src/features/composer/composer.css`.

## Worktree notes
- UC09 was implemented on `feature/t0427cb-trang-thai-va-nhat-ky-hoat-dong-bai-dang`; current UC13 work is on `feature/t0427ce-bao-cao-truyen-thong`.
- Existing modified `backend/**/__pycache__/*.pyc` files were present before UC09 work and must be preserved.

## UC13: Media reports
- The report screen is `frontend/src/app/reports.html`, styled with the existing Composer Manrope and green/sage system plus `frontend/src/features/reports/reports.css`.
- Read-only reporting is served by `GET /reports/` for Admin, Manager, and Viewer. Filters: metric collection date range, channel, campaign tag, and post status.
- `post_metrics` stores cumulative snapshots at post level, not channel level. The API selects the newest snapshot per post within the requested range; daily trend is a sum of snapshots collected on each date, not daily net growth.
- Channel comparison only attributes posts linked to exactly one channel. Posts linked to multiple channels remain in overall totals and are counted in the data-quality note, but excluded from per-channel comparison to avoid duplicating metrics.
- This schema cannot support accurate platform-specific metrics for multi-channel posts until `post_metrics` stores a `channel_id` (or an equivalent per-channel snapshot key).
- CSV export is generated in the browser from the current report result. The main navigation now links to `reports.html` from Composer and post tracking.
