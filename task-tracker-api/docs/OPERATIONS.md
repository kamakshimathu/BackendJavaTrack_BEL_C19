# Storage and database operations

Run application and cleanup processes from `task-tracker-api/` with the same DATABASE_URL and UPLOAD_DIR. Relative upload roots resolve from the working directory; prefer an absolute private deployment path. Restrict access to the service identity. Never expose uploads through static hosting. Multiple instances/workers need the same physical shared storage with the adapter's exclusive-write/file-operation semantics; separate local disks cannot safely share metadata.

## Cleanup scheduling (manual example)

Build first with `npm.cmd run build`. In Windows Task Scheduler, create a task running as the application service identity every five minutes:

| Setting | Value |
| --- | --- |
| Program | Absolute path to node.exe (find using `Get-Command node`) |
| Arguments | `dist/services/storage/cleanup-command.js` |
| Start in | `C:\Airtribe\BackendJavaTrack_BEL_C19\task-tracker-api` |
| Existing instance | Do not start a new instance |

No credentials go into arguments. Load the private `.env` from this working directory or provision environment variables securely. No task was installed. Verify permissions under the task's actual identity and inspect exit codes. A deployment job runner/cron is an alternative.

The CLI processes up to 100 due jobs and prints cleaned/failed counts only. Exit 1 means database/storage access failed or some deletions failed. Repeat runs to drain larger batches. Failed jobs wait 60 seconds; interrupted upload reservations become eligible after one hour. Concurrent workers lock rows with SKIP LOCKED. Live metadata references are protected; missing files are idempotent successful cleanup.

## Recovery and retention

Monitor due/total FileCleanup counts, oldest notBefore, task failures, and free disk. Restore permissions, release Windows file locks, or restore mounted storage before retrying. Preserve queue records: never truncate FileCleanup, remove its trigger, change upload roots mid-queue, or delete arbitrary files to suppress errors. Restore missing storage mounts before allowing new writes. Back up metadata and files together and test restore consistency.

Metadata deletion is transactional with queuing, not physical deletion. Pending files can occupy disk indefinitely during outages. There is no automatic quota or global directory scan: arbitrary files without metadata/reservations are not discovered. Writes stalled beyond their lease or severe disk/power failures may need careful manual reconciliation. A membership change does not interrupt a download already authorized and opened.

Retain consumed refresh rows until their family's absolute expiry for replay detection. A separately reviewed daily job can remove expired sessions:

```sql
DELETE FROM "RefreshSession" WHERE "expiresAt" < NOW();
```

No session/invitation maintenance scheduler is installed. Invitation reads derive expiry; write transitions persist it. Historical timezone corrections need a separate audit; do not bulk rewrite timestamps.

## Migrations and deployment

Review the five SQL migrations, especially partial indexes, task completedAt CHECK, and attachment AFTER DELETE trigger. Apply with `npm.cmd run prisma:migrate:deploy` against the confirmed database. Generate/build with development dependencies. Deploy dist, manifest/lockfile, production dependencies, and privately provisioned environment/storage. Never deploy development `.env` or test credentials.

The authentication migration adds required passwordHash without a fake default. A populated legacy User table requires staged enrollment; never reset user data to force it through. Avoid db push, which does not reproduce custom SQL history. Health checks SELECT 1, not schema currency. Test databases must have separate names ending `_test` and require operator setup.
