# Task Tracking and Team Collaboration API

An Airtribe backend assignment covering accounts, teams, invitations, projects, tasks, comments, and private attachments. This feature-based modular monolith exposes a REST API. No frontend, email delivery, notifications, or AI features are included.

## Features and tech stack

- Registration, secure login, rotating refresh sessions, logout, profile management.
- OWNER/ADMIN/MEMBER permissions, invitations, and team-scoped projects.
- Task CRUD, assignment, completion, personal feed, filters, search, pagination.
- Comments, authenticated uploads/downloads, and durable file cleanup.
- Node.js **22.13.0**, Express **5.3.0**, strict TypeScript **5.9.3**, ESM, PostgreSQL **17.2**, Prisma **7.10.1**, Zod, Argon2id, JWTs.

## Architecture and project structure

```text
prisma/schema.prisma          Domain models
prisma/migrations/            Five forward migrations and custom SQL
prisma.config.ts              Prisma CLI connection/migration configuration
src/config/                  Validated environment, shared database client
src/middleware/              Authentication, JSON 404, safe centralized errors
src/modules/                 health, auth, users, teams, invitations,
                             projects, tasks, comments, attachments
src/services/storage/        Private disk storage, cleanup queue and CLI
src/shared/                  Errors, strict request schemas, pagination
src/app.ts                   Express middleware and route registration
src/server.ts                Startup, listener, graceful shutdown
scripts/                     Guarded test migrations and documentation tools
tests/                       Security, PostgreSQL integration, runtime checks
docs/                        OpenAPI specification, operations, QA report
../.github/workflows/        Parent repository's task-tracker-ci.yml
```

Routes parse strict Zod schemas and delegate domain work to services. Services use Prisma directly; team writes share a transaction and team row lock, while refresh rotation uses a family advisory lock. Express 5 forwards rejected async handlers to shared error middleware. Extra controller/repository layers would add little value at this scale.

Prisma CLI, client, and PostgreSQL adapter are pinned to **7.10.1**. Prisma 7 reads the CLI URL from `prisma.config.ts`; the `prisma-client` generator writes TypeScript to ignored `src/generated/prisma`. Runtime uses `PrismaPg`, UTC sessions, and `.js` ESM imports. Build compiles the generated client too. Do not replace migrations with `db push`: partial indexes, CHECK constraints, and a cleanup trigger are part of the design.

## Prerequisites and PostgreSQL setup

Install Node 22.13.0 with npm, PostgreSQL 17.2, and optionally VS Code/Postman. Use `npm.cmd` in Windows PowerShell to avoid execution-policy restrictions on `npm.ps1`.

An administrator can run these commands in **psql**, after confirming server and database names. `\password` prompts privately; keep real passwords out of committed SQL and shell history.

```sql
CREATE ROLE task_tracker_app LOGIN;
\password task_tracker_app
CREATE DATABASE task_tracker OWNER task_tracker_app;
CREATE DATABASE task_tracker_test OWNER task_tracker_app;
```

These are manual examples, not startup actions. Use a separate disposable `_test` database. Applying existing migrations needs ownership/DDL privileges, not superuser access. Authoring migrations with `migrate dev` also needs an approved shadow database or CREATEDB privilege. Separate runtime and migration privileges for deployment.

## Installation and environment configuration

From `task-tracker-api/`:

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
code .env
```

Configure `.env` privately. Never overwrite an existing file or commit credentials. Percent-encode special characters in PostgreSQL credentials.

| Variable | Requirement/default |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL URL with database name |
| `JWT_SECRET` | Required random hex, at least 32 bytes; no fallback |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Required nonempty identifiers |
| `NODE_ENV`, `PORT` | Optional; `development`, `3000` |
| `CORS_ORIGIN` | Optional single origin; `http://localhost:5173` |
| `ACCESS_TOKEN_TTL_SECONDS` | Optional; 900, permitted 60–900 |
| `REFRESH_TOKEN_TTL_DAYS` | Optional; 7, permitted 1–30 |
| `UPLOAD_DIR` | Optional; `.private/uploads`, relative to working directory |
| `TEST_DATABASE_URL` | Required for database/runtime tests; different DB name ending `_test` |

Generate a secret into the clipboard, paste it into the private editor, then clear it:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')" | Set-Clipboard
# Paste into JWT_SECRET in .env, then:
Set-Clipboard -Value ''
```

Environment failures report field names without values. Client generation permits an absent database URL; startup and migrations require real configuration.

## Prisma migrations and starting the server

After confirming the target database and reviewing migration SQL:

```powershell
npm.cmd run prisma:validate
npm.cmd run prisma:migrate:deploy
npm.cmd run prisma:generate
npm.cmd run typecheck
npm.cmd run dev
```

Installation/startup never creates databases, migrates, or resets them automatically. Future schema changes: `npm.cmd run prisma:migrate -- --name change_name`; review shadow database/reset prompts. The historical authentication migration requires an empty legacy User table when adding required password hashes; populated legacy deployments need a separate staged enrollment plan.

Production build/start:

```powershell
npm.cmd run build
npm.cmd start
```

Build with development dependencies first, then deploy `dist`, the manifest/lockfile, and production dependencies (`npm.cmd ci --omit=dev`). Start and cleanup run compiled JavaScript without tsx. Apply migrations in a separate release environment with the Prisma CLI available. Startup verifies PostgreSQL before listening; Ctrl+C/SIGTERM drains HTTP and disconnects Prisma, with a ten-second limit.

## Authentication flow and roles

Register, log in, send `Authorization: Bearer <accessToken>`, and replace the saved refresh token after **every** refresh. Serialize refresh requests. Logout revokes that refresh family; independent logins remain active. Replay of a consumed refresh token revokes its family. Issued access tokens remain valid until expiry (at most 15 minutes). Only profile `name` is editable.

Passwords are 12–128 characters with lowercase, uppercase, digit, and a non-alphanumeric character. Emails are lowercased. Argon2id uses per-password salts, 19 MiB memory, two passes, and one lane. JWT verification checks HS256, issuer, audience, subject, expiry, issued-at, token type, and identifier. Only hashes of opaque refresh tokens are stored.

| Action | Permission |
| --- | --- |
| Read team/project/task; create unassigned task; comment/upload | Any current team member |
| Manage team details/projects/invitations; assign tasks | OWNER or ADMIN |
| Change MEMBER/ADMIN roles | OWNER |
| Remove member | OWNER: ADMIN/MEMBER; ADMIN: MEMBER; MEMBER: self |
| Edit/delete task | Managers or creator |
| Change task status | Managers, creator, or current assignee |
| Edit comment | Author; managers may moderate by deleting |
| Delete attachment | Uploader or managers |

ADMIN cannot leave voluntarily under the existing rule forbidding ADMIN removal of ADMIN. OWNER must demote them to MEMBER first. OWNER cannot leave/be demoted; ownership transfer is future work. MEMBER task creation permits omitted `assignedToId` or explicit `null`, but no non-null assignment, including self-assignment. All mutation rules also check current membership.

Invitees register first; managers invite their registered email, and invitees list/accept/decline invitations while authenticated. Invitations expire after seven days; GET derives expiry without writes. Email delivery and mailbox ownership verification are absent.

## Database design

UUID keys link User → RefreshSession and Team → TeamMember/TeamInvitation/Project → Task → TaskComment/TaskAttachment. Unique email, membership pairs, refresh hashes, and storage keys prevent duplicates. Partial indexes allow one OWNER and one pending invitation per team/email. Task completion has a database CHECK: COMPLETED requires completedAt; other states require null. Timestamps are `timestamptz`; application sessions use UTC.

Parent deletion cascades to dependent collaboration records; ownership/creator references restrict some user deletions, and assignee deletion clears assignments. Services serialize assignment/member removal and clear removed members' assignments. Minimum-one-owner, ownerId agreement, and assignment membership are service invariants, not fully enforced against arbitrary SQL. Attachment deletion triggers FileCleanup jobs, including cascades. Account/team/project deletion endpoints are not exposed.

## REST API endpoints

Base URL: `http://localhost:3000`. All except health/auth require Bearer authentication. Bodies, response schemas, parameters, and errors: [validated static OpenAPI specification](docs/openapi.json), **38 operations**. Import it into an OpenAPI-compatible tool; there is no runtime Swagger UI.

| Area | Methods and paths |
| --- | --- |
| Health | GET `/api/health` |
| Auth | POST `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` |
| Profile | GET/PATCH `/api/users/me` |
| Teams | POST/GET `/api/teams`; GET/PATCH `/api/teams/{teamId}` |
| Members | GET `/api/teams/{teamId}/members`; PATCH/DELETE `/api/teams/{teamId}/members/{userId}` |
| Invitations | POST `/api/teams/{teamId}/invitations`; GET `/api/invitations`; POST `/api/invitations/{invitationId}/accept` or `/decline` |
| Projects | POST/GET `/api/teams/{teamId}/projects`; GET/PATCH `/api/projects/{projectId}` |
| Tasks | POST/GET `/api/projects/{projectId}/tasks`; GET `/api/tasks/assigned-to-me`; GET/PATCH/DELETE `/api/tasks/{taskId}`; PATCH `/api/tasks/{taskId}/assignee` or `/status` |
| Comments | POST/GET `/api/tasks/{taskId}/comments`; PATCH/DELETE `/api/comments/{commentId}` |
| Attachments | POST/GET `/api/tasks/{taskId}/attachments`; GET `/api/attachments/{attachmentId}/download`; DELETE `/api/attachments/{attachmentId}` |

Creation returns 201, reads/updates 200, deletion/logout 204. Errors use `{"error":{"message":"..."}}`: 400 invalid input, 401 unauthenticated, 403 forbidden, 404 absent/inaccessible, 409 conflict, 413 oversized, 415 unsupported file/body, 422 assignee outside the team, 429 rate limit, 500 unexpected failure. Task deletion also hides unauthorized targets behind 404. Unknown fields/query parameters and invalid UUIDs are rejected. Health: 200 `{"status":"ok","database":"connected","timestamp":"<ISO>"}`, or 503 with `unavailable`/`disconnected`. It checks connectivity, not schema currency.

## Pagination, sorting, and search

Collections return named arrays plus `pagination: {page, limit, total}`. Defaults: page 1, limit 20; maximums: page 100000, limit 100. Team/member order is joinedAt then UUID; invitation/project/comment/attachment order is createdAt then UUID, ascending. Tasks default to createdAt descending, with UUID tie-breaker; sortBy supports createdAt, updatedAt, dueDate, priority, status; sortOrder supports asc/desc. Null due dates sort last. Enums sort in PostgreSQL declaration order. Offset pages can shift during writes; count/results are not guaranteed a snapshot.

Both task feeds support status, priority, and case-insensitive literal title/description search. Project tasks additionally support `assignedToId=<UUID>` or `assignedToId=null`; the personal feed supports projectId. Dates accept ISO timestamps with offsets and return UTC ISO strings. Example: `/api/tasks/assigned-to-me?status=TODO&search=review&sortBy=dueDate&sortOrder=asc&page=1&limit=20`.

## Comments, attachments, and storage cleanup

Comments are plain text (1–5000 characters), not rendered HTML. Upload multipart field `file`, one file only, maximum **5 MiB**. Allowed matching extension/MIME pairs: PDF, PNG, JPG/JPEG, UTF-8 TXT. Conservative filenames, matching MIME/signatures, and text checks reject unsafe content; signature checks are not antivirus/full parsing. Uploads use random storage keys, private disk, four concurrent requests per process, and 60 uploads/IP/15 minutes. Downloads reauthorize membership and force attachment disposition, nosniff, no-store, and sandbox CSP.

PostgreSQL and disk are not one transaction. Reservations protect uploads for one hour; SQL deletion triggers enqueue physical cleanup. A 204 means metadata is removed; failed physical deletion remains queued. Failures back off for 60 seconds so older poison jobs do not starve the queue. Workers use row locks/SKIP LOCKED and protect live attachment references.

```powershell
# Build once, then run periodically with the same database and upload root:
npm.cmd run build
npm.cmd run storage:cleanup
```

The independent command handles at most 100 due jobs and exits nonzero on failures. [Operations guide](docs/OPERATIONS.md) includes a Windows Task Scheduler example, recovery, retention, and shared storage requirements. No scheduler is installed automatically.

## API testing examples (PowerShell)

Use disposable local credentials; keep tokens in variables:

```powershell
$base = 'http://localhost:3000'
$email = Read-Host 'Registered test email'
$password = Read-Host 'Test password' -AsSecureString
$credential = [pscredential]::new($email, $password)
$loginBody = @{email=$email; password=$credential.GetNetworkCredential().Password} | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json' -Body $loginBody
$headers = @{Authorization="Bearer $($session.accessToken)"}
Invoke-RestMethod -Uri "$base/api/users/me" -Headers $headers
# Set projectId to an actual UUID after creating a team/project:
$task = Invoke-RestMethod -Method Post -Uri "$base/api/projects/$projectId/tasks" -Headers $headers -ContentType 'application/json' -Body '{"title":"Review API","assignedToId":null}'
Invoke-RestMethod -Method Patch -Uri "$base/api/tasks/$($task.task.id)/status" -Headers $headers -ContentType 'application/json' -Body '{"status":"COMPLETED"}'
$upload = curl.exe --silent --show-error --fail-with-body "$base/api/tasks/$($task.task.id)/attachments" -H "Authorization: Bearer $($session.accessToken)" -F 'file=@C:/path/to/notes.txt;type=text/plain'
Invoke-RestMethod -Method Post -Uri "$base/api/auth/logout" -ContentType 'application/json' -Body (@{refreshToken=$session.refreshToken} | ConvertTo-Json)
```

Example profile response: `{"user":{"id":"<uuid>","name":"Reviewer","email":"reviewer@example.com","createdAt":"<ISO>","updatedAt":"<ISO>"}}`. Registration uses POST `/api/auth/register` with name/email/password. Refresh uses POST `/api/auth/refresh` with the latest refreshToken and returns replacement tokens. Postman supports the same JSON; use form-data/File for attachments and let it set the multipart boundary.

## Automated tests and CI

Set TEST_DATABASE_URL privately to a confirmed separate `_test` database. Then:

```powershell
npm.cmd run test:db:migrate
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:runtime
npm.cmd run docs:validate
npm.cmd audit --audit-level=high
```

Tests guard database names, use unique fixtures and temporary storage, and remove their own data/files without resets/truncation. Without TEST_DATABASE_URL, database suites skip; that does not prove persistence correctness. Runtime tests require a build and exercise real HTTP, database outage, environment failure, compiled cleanup, and shutdown. On Windows, IPC invokes the actual SIGTERM handler because POSIX signal delivery is unavailable.

See [QA report and requirements matrix](docs/QA-REPORT.md) for verification evidence. The parent-level CI workflow provisions disposable PostgreSQL 17.2/Node 22.13.0, installs the lockfile, migrates, validates docs, typechecks, builds, tests, and audits with CI-only settings. Hosted execution requires pushing/reviewing these changes; local validation is not a hosted CI pass.

## Security considerations, known limitations, and future improvements

Implemented controls include safe errors, strict schemas, parameterized queries, public-field selections, Helmet, CORS, and request limits. Authentication IP limits allow 20 login/register or 100 refresh/logout requests per 15 minutes. Use HTTPS and private token storage outside localhost. CORS is not authorization. Browser cookie refresh/CSRF controls are not implemented. Configure only known reverse-proxy hops; rate limits use in-memory per-process stores.

This assignment MVP is not a production security certification. Email verification, password recovery, immediate access-token revocation, distributed throttling, quotas, malware scanning, monitoring/backups, ownership transfer, and cursor pagination remain future work. Historical timestamps from before UTC session correction need a separate review; none were rewritten. Large substring searches need performance evaluation/trigram indexes before growth. Optional email delivery, notifications, AI assistance, and a frontend remain unimplemented.

Never commit `.env`, token-bearing Postman exports, uploads, build output, or generated client files. See the QA report for submission checks, confirmed migration state, and remaining Git/CI review steps.
