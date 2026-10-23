# Task Tracker API

Milestone 4: task management, assignment, search, filtering, sorting, and pagination, preserving authentication, teams, invitations, and projects. No comments, attachments, notifications, WebSockets, or AI features.

## Stack and configuration

- Node.js **22.13.0**, npm, Express **5**, TypeScript **5.9.3**, PostgreSQL **17.2**.
- Prisma CLI, `@prisma/client`, and `@prisma/adapter-pg` are all pinned to **7.10.1**. This stable release supports Node 22.13.0. The registry default at setup time was an incompatible Prisma 8 release candidate, so it was deliberately avoided.
- Prisma 7 uses `prisma.config.ts` for the CLI connection URL, explicit dotenv loading, and the stable `prisma-client` generator with an explicit output directory. Runtime connections use `PrismaPg`, not the old engine configuration. See [Prisma requirements](https://www.prisma.io/docs/orm/reference/system-requirements) and [Prisma configuration](https://www.prisma.io/docs/orm/reference/prisma-config-reference).
- ESM with NodeNext resolution and strict TypeScript checks. Local imports end in `.js` so compiled JavaScript runs directly in Node. The generated client also uses `.js` imports.
- Exact direct dependency versions are in `package.json`; `package-lock.json` locks the dependency tree. Use `npm.cmd ci` for subsequent installs.

## Structure

```text
prisma/
  schema.prisma              # Users, sessions, teams, invitations, projects, tasks
  migrations/                # Forward-only foundation/auth/collaboration/task migrations
prisma.config.ts             # Prisma CLI configuration
src/
  config/
    env.ts                   # Validates settings without printing secrets
    database.ts              # Shared Prisma Client and PostgreSQL pool
  generated/prisma/          # Generated locally; ignored by Git
  middleware/
    not-found.ts
    error-handler.ts
    authenticate.ts
  modules/
    health/health.routes.ts
    auth/                    # Validation, password hashing, JWTs, sessions, routes
    users/                   # Public profile selection and protected routes
    teams/                   # Team routes, membership rules, transaction helpers
    invitations/             # Invite creation, listing, accept/decline
    projects/                # Team-scoped project access
    tasks/                   # Task schemas, routes, permission/assignment services
  shared/app-error.ts        # Expected application errors
  shared/request-schemas.ts  # Strict UUID/body/query validation and pagination
  app.ts                     # Express middleware and routes
  server.ts                  # Database startup, HTTP server, shutdown
```

A small modular monolith: shared configuration and middleware, with routes grouped by feature. Routes validate requests, authentication services implement credential/session rules, and Prisma handles persistence directly. No repository abstraction is needed. `User` has a UUID id, name, normalized unique email, password hash, and timezone-aware timestamps. One user has many refresh sessions; deleting a user cascades to their sessions.

## Local setup (PowerShell)

Use `npm.cmd` to avoid Windows PowerShell execution-policy restrictions on `npm.ps1`.

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
code .env
```

Set `DATABASE_URL` to confirmed credentials for your existing PostgreSQL 17.2 database. Percent-encode special characters in credentials. Keep `.env` private. `PORT` defaults to 3000; `NODE_ENV` defaults to development; `CORS_ORIGIN` defaults to `http://localhost:5173` and allows one frontend origin.

Add the authentication settings from `.env.example` to your existing `.env` manually. `JWT_SECRET` has no fallback: use at least 32 cryptographically random bytes encoded as hex. The validator rejects short, malformed, and obvious low-diversity values; it cannot prove randomness. Generate a secret into your clipboard without printing it, then paste it as `JWT_SECRET` in the private editor:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')" | Set-Clipboard
code .env
# Clear the clipboard after pasting:
Set-Clipboard -Value ''
```

Also set `JWT_ISSUER=task-tracker-api`, `JWT_AUDIENCE=task-tracker-client`, `ACCESS_TOKEN_TTL_SECONDS=900`, and `REFRESH_TOKEN_TTL_DAYS=7`. Access TTL is bounded to 60–900 seconds; refresh TTL to 1–30 days. Missing authentication configuration prevents startup, including the health route, rather than using an insecure signing key.

No database is automatically created or migrated during installation, generation, or application startup. Before running the migration below, confirm the database host/name and that it is an intended development database. Prisma Migrate can offer to create a missing database and needs a shadow database to detect drift; this may require PostgreSQL `CREATEDB` privileges. Review any reset prompt before accepting it.

```powershell
npm.cmd run prisma:generate
npm.cmd run typecheck
npm.cmd run prisma:validate
# Review pending migration SQL, including:
# prisma/migrations/20261024000300_task_management/migration.sql
# Apply the already generated forward migration to the confirmed target:
npm.cmd run prisma:migrate:deploy
# Prisma 7 migrations do not generate the client automatically:
npm.cmd run prisma:generate
npm.cmd run dev
```

In another PowerShell terminal:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/health
```

The endpoint executes `SELECT 1`, returning HTTP 200 with `status: "ok"` and `database: "connected"`, or HTTP 503 with `status: "unavailable"` and `database: "disconnected"`. Both include a timestamp. This verifies connectivity, not migration state or the existence of the User table. The server refuses to listen if its startup database check fails.

Unknown routes return JSON 404 responses. Malformed, oversized, or unsupported JSON bodies receive safe client errors; unexpected errors receive a generic 500 without stack traces or credentials. Express 5 forwards rejected async handlers to the central error handler. Ctrl+C/SIGTERM stops new requests, drains HTTP requests, then disconnects Prisma, with a ten-second shutdown limit.

## Commands

| Command | Purpose |
| --- | --- |
| `npm.cmd run dev` | Watch TypeScript source with tsx |
| `npm.cmd run typecheck` | Check application, Prisma config, and test types |
| `npm.cmd run build` | Generate Prisma Client and compile to dist |
| `npm.cmd start` | Run compiled server |
| `npm.cmd run prisma:generate` | Generate client; no database connection required |
| `npm.cmd run prisma:validate` | Validate Prisma schema |
| `npm.cmd run prisma:migrate -- --name change_name` | Generate and apply a future development migration |
| `npm.cmd run prisma:migrate:deploy` | Apply existing migration files |
| `npm.cmd run prisma:studio` | Open Prisma Studio against the configured database |

CLI configuration permits an absent DATABASE_URL for offline client generation. Database commands require a real URL, and application startup always validates it. Commit schema migrations once reviewed; do not commit generated client files, build output, or secrets.

## Forward migration safety

During Milestone 2 the existing database was inspected read-only and had zero User rows. The authentication migration adds required `passwordHash` without a default, creates RefreshSession, and runs in a transaction. It does not reset tables or invent passwords. If legacy User rows exist when you apply that migration, PostgreSQL rejects the required column and rolls back. Stop and plan a staged nullable-column/account-enrollment migration; do not delete users or accept a reset to get past it. Previously existing mixed-case emails would also need a deliberate normalization/conflict review in that scenario.

The Milestone 3 migration is additive: it creates four tables, two enums, foreign keys, and indexes without changing existing users or sessions. It is wrapped in a transaction and has been applied only to the approved isolated test database. The development database is not migrated automatically. Use `prisma:migrate:deploy` to apply the existing reviewed migration, not a reset.

The Milestone 4 migration is also additive: it creates Task, TaskStatus, TaskPriority, foreign keys, five indexes, and a completion-consistency CHECK. It does not change existing user/team/project rows. It has been applied to the isolated test database only. No new dependencies or environment settings are needed.

## Authentication and profile API

All requests below use JSON and base URL `http://localhost:3000`. In Postman, choose Body → raw → JSON. Successful user responses contain only `id`, `name`, `email`, `createdAt`, and `updatedAt`.

| Method and path | Request | Response |
| --- | --- | --- |
| POST `/api/auth/register` | `{"name":"Test User","email":"test@example.com","password":"StrongPassword123!"}` | 201 `{"user":{"id":"<uuid>","name":"Test User","email":"test@example.com","createdAt":"<ISO timestamp>","updatedAt":"<ISO timestamp>"}}` |
| POST `/api/auth/login` | `{"email":"test@example.com","password":"StrongPassword123!"}` | 200 token response below |
| POST `/api/auth/refresh` | `{"refreshToken":"<latest refresh token>"}` | 200 token response with replacement refresh token |
| POST `/api/auth/logout` | `{"refreshToken":"<refresh token>"}` | 204, empty body; same result for unknown/already revoked well-formed tokens |
| GET `/api/users/me` | `Authorization: Bearer <accessToken>` | 200 `{"user":{...public profile fields}}` |
| PATCH `/api/users/me` | Same Bearer header; `{"name":"Updated Name"}` | 200 updated public profile |

Token response:

```json
{
  "tokenType": "Bearer",
  "accessToken": "<signed JWT>",
  "expiresIn": 900,
  "refreshToken": "<43-character opaque token>",
  "refreshExpiresAt": "<ISO timestamp>"
}
```

In Postman, place `accessToken` in Authorization → Bearer Token. Replace the stored refresh token after each refresh; never send two refreshes concurrently. Registration does not log in or grant permissions. Only `name` can be changed in this milestone. Empty updates and unknown fields (including email, passwordHash, role, and id) are rejected.

Passwords are 12–128 characters, requiring lowercase, uppercase, digit, and a non-alphanumeric character; passwords are never trimmed. Names are trimmed and bounded to 100 characters. Emails are trimmed, lowercased, and bounded to 254 characters; provider-specific dot/plus rewriting is not performed. Argon2id uses a unique random salt, 19 MiB memory, two passes, and one lane, following the [OWASP minimum recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). The Windows-compatible `@node-rs/argon2` package avoids a local C++ build-tool requirement.

Invalid input returns 400; duplicate email 409; invalid login 401 with the same `Invalid email or password` message for both missing accounts and wrong passwords. Missing users still perform dummy Argon2 verification to reduce timing differences. A database unique constraint catches concurrent duplicate registrations. Expected errors use `{"error":{"message":"..."}}`; SQL details and stack traces are never returned.

JWTs use HS256 with a privately configured key, explicit algorithm verification, issuer, audience, subject UUID, issued-at, expiry, random JWT id, `typ: at+jwt`, and `token_use: access`. They contain no email, password hash, or permissions. Middleware verifies all required claims and then loads the current user. Deleted users are denied. Opaque refresh tokens are never accepted as access JWTs.

Refresh tokens contain 32 secure random bytes. Only SHA-256 hashes are stored; high token entropy makes a fast cryptographic hash appropriate here. Every login creates an independent family. Refresh rotation runs inside a transaction, taking a PostgreSQL transaction-scoped advisory lock for that family, rechecking revocation/expiry, consuming the old row, and inserting a replacement atomically. Logout takes the same lock.

Reusing a consumed/revoked token revokes every remaining refresh token in that family. Other login families stay active. Concurrent refreshes produce one winner and one rejection; the losing replay revokes the winner's replacement too. Clients must serialize refresh requests; a lost response may require logging in again. Logout revokes the supplied token's entire family, even if that token was already rotated. It is safe to retry. Malformed logout input still returns 400.

**Logout and reuse detection do not invalidate already issued access JWTs.** They remain usable until expiry (at most 15 minutes), unless the user is deleted or the signing key is changed. Immediate per-session access revocation is not implemented.

Each family's refresh expiry is absolute from login and does not slide on rotation. Keep consumed/revoked rows until that expiry so replay can be detected. Schedule a daily maintenance job to execute `DELETE FROM "RefreshSession" WHERE "expiresAt" < NOW();`. `expiresAt` is indexed for cleanup, `tokenHash` is uniquely indexed for lookup, `familyId` for revocation, and `userId` for user-session operations. Cleanup is documented, not scheduled automatically.

## Teams, invitations, and projects

Every new endpoint requires `Authorization: Bearer <accessToken>`. Roles are read from current PostgreSQL memberships on every operation; they are never trusted from JWT claims or request bodies. Permission checks live in services and apply even when routes are bypassed. A nonmember receives the same 404 response for an unknown and an inaccessible team/project. A known team member with insufficient permissions receives 403.

### Data model

- `Team`: UUID, name, nullable description, owner user, timestamps; has memberships, invitations, and projects. Creation inserts the team and its OWNER membership atomically. Owner identity is immutable in this milestone.
- `TeamMember`: UUID, team/user relation, OWNER/ADMIN/MEMBER role, joinedAt. `(teamId, userId)` is unique; userId is indexed for listing a user's teams. A PostgreSQL partial unique index allows at most one OWNER per team. Services prevent removing or demoting that owner.
- `TeamInvitation`: UUID, team, normalized invitedEmail, inviting user, PENDING/ACCEPTED/DECLINED/EXPIRED status, expiry, creation/response times. Indexes support email listing, team/email lookups, sender references, and expiry processing. A partial unique index allows only one stored PENDING invitation per team/email while preserving history.
- `Project`: UUID, team, name, nullable description, creator user, timestamps. `(teamId, createdAt, id)` supports ordered team listing; createdById is indexed. Names may repeat within and across teams; project IDs identify projects.

Deleting a team cascades to its memberships, invitations, and projects. Memberships cascade when their user is deleted. Team owner, invitation sender, and project creator references restrict user deletion to preserve ownership/history. Account deletion and team deletion endpoints are not part of this milestone. Partial indexes are maintained explicitly in the SQL migration; Prisma's schema file comments identify these custom constraints. Do not replace migrations with `db push` or lose those indexes in future migration edits.

### Permission matrix

| Action | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| View team, members, and projects | Yes | Yes | Yes |
| Update team details | Yes | Yes | No |
| Invite registered users | Yes | Yes | No |
| Create/update projects | Yes | Yes | No |
| Change MEMBER/ADMIN roles | Yes | No | No |
| Remove another member | ADMIN or MEMBER targets | MEMBER targets only | No |
| Remove own membership | No | No | Yes |

The ADMIN self-removal restriction follows the rule that ADMIN must never remove an ADMIN. An owner may first demote that administrator to MEMBER so they can leave. There is no ownership transfer or OWNER assignment endpoint. To leave, an OWNER needs a future ownership-transfer workflow.

Team writes acquire a row lock on the team inside a Prisma transaction **before** reading current roles. Membership changes, invitations, and project writes share this order, preventing a stale role check from authorizing a write after demotion/removal commits. This deliberately serializes writes within one team for straightforward MVP correctness. Different teams can write independently.

### Endpoints and JSON examples

Names are trimmed, nonempty, and at most 100 characters. Descriptions are optional, at most 2,000 characters, and may be cleared with null. Patches must change at least one allowed field. All bodies, IDs, and query strings are validated with strict Zod schemas; unknown fields, malformed UUIDs, invalid pagination, and empty patches return 400.

| Method/path | Example body or query | Successful response |
| --- | --- | --- |
| POST `/api/teams` | `{"name":"Platform","description":"Backend team"}` | 201 `{"team":{"id":"<uuid>","name":"Platform","description":"Backend team","ownerId":"<current-user-id>","role":"OWNER","createdAt":"<ISO>","updatedAt":"<ISO>"}}` |
| GET `/api/teams` | `?page=1&limit=20` | 200 `{"teams":[{"id":"<uuid>","role":"OWNER","...":"team fields"}],"pagination":{"page":1,"limit":20,"total":1}}` |
| GET `/api/teams/:teamId` | None | 200 `{"team":{...team fields and current role}}` |
| PATCH `/api/teams/:teamId` | `{"name":"Platform v2","description":null}` | 200 `{"team":{...updated team fields}}` |
| GET `/api/teams/:teamId/members` | `?page=1&limit=20` | 200 `{"members":[{"id":"<membership-id>","teamId":"<team-id>","userId":"<user-id>","role":"MEMBER","joinedAt":"<ISO>","user":{...public profile}}],"pagination":{...}}` |
| PATCH `/api/teams/:teamId/members/:userId` | `{"role":"ADMIN"}` or `{"role":"MEMBER"}` | 200 `{"member":{...membership and public profile}}` |
| DELETE `/api/teams/:teamId/members/:userId` | No body | 204 empty body |
| POST `/api/teams/:teamId/invitations` | `{"email":"registered@example.com"}` | 201 `{"invitation":{...invitation fields}}` |
| GET `/api/invitations` | `?page=1&limit=20` | 200 `{"invitations":[{...invitation fields,"team":{"id":"<uuid>","name":"Platform"}}],"pagination":{...}}` |
| POST `/api/invitations/:invitationId/accept` | No body or `{}` | 200 `{"invitation":{...fields,"status":"ACCEPTED"}}` |
| POST `/api/invitations/:invitationId/decline` | No body or `{}` | 200 `{"invitation":{...fields,"status":"DECLINED"}}` |
| POST `/api/teams/:teamId/projects` | `{"name":"API","description":"First release"}` | 201 `{"project":{"id":"<uuid>","teamId":"<team-id>","createdById":"<current-user-id>","name":"API","description":"First release","createdAt":"<ISO>","updatedAt":"<ISO>"}}` |
| GET `/api/teams/:teamId/projects` | `?page=1&limit=20` | 200 `{"projects":[{...project fields}],"pagination":{...}}` |
| GET `/api/projects/:projectId` | None | 200 `{"project":{...project fields}}` |
| PATCH `/api/projects/:projectId` | `{"name":"API v2","description":null}` | 200 `{"project":{...updated project fields}}` |

`...` in response examples abbreviates the documented public fields. Invitation fields are `id`, `teamId`, `invitedEmail`, `invitedById`, `status`, `expiresAt`, `createdAt`, and `respondedAt`. No credential/session fields are loaded into these responses. ownerId, createdById, teamId, roles, and invitation identity are assigned by the server where appropriate, never from privileged body fields.

All collection endpoints use page/limit pagination: defaults 1/20, limit 1–100, page 1–100,000. Teams/members sort by joinedAt then UUID; invitations/projects sort by createdAt then UUID, ascending. Offset pagination is deterministic for a fixed dataset; concurrent inserts/removals can shift pages, and totals are not a cross-request snapshot. Only a user's memberships, their invitations, and projects/members in an authorized team are included.

### Invitations without email delivery

1. The invitee registers normally first. An OWNER/ADMIN creates an invitation using their normalized account email. Existing members and duplicate active invitations return 409; unregistered invitees return 404.
2. The invitee signs in and calls GET `/api/invitations` to discover their invitations. There is no email delivery, notification, or bearer invitation token.
3. The invitee submits the invitation UUID to accept or decline. Every response verifies their **current database email**; knowing another invitation UUID grants no access. Acceptance always inserts MEMBER, never a role chosen by the invitee.

Email ownership verification was not implemented in Milestone 2. These endpoints match the authenticated account's registered email; they do **not** establish ownership of that mailbox. Verified-email gating remains a prerequisite for a production email-based invitation system. Email changes remain unavailable through profile endpoints. If added later, old invitations stop matching as soon as the account email changes; they do not follow the user ID and must be reissued. Email reuse/account reassignment also needs a deliberate verification policy.

Expiry is seven days from creation. GET requests derive EXPIRED in responses for overdue PENDING records without writing to PostgreSQL. Accept/decline of such a record commits its EXPIRED transition before returning 409. Creating a replacement invitation also persists expiry of matching overdue PENDING records before inserting the new one. Otherwise, a stored overdue record may remain PENDING until a write touches it; use expiresAt to determine effective status. No background expiry job is scheduled. respondedAt remains null for expiry because the invitee did not respond.

Acceptance and membership creation share a transaction and the team lock. Simultaneous acceptance yields one 200 and one 409, with exactly one membership. Repeated acceptance, acceptance after decline, and expired responses return 409 without adding membership. Repeated decline returns the unchanged declined record with the same respondedAt; decline after acceptance returns 409. Consumed invitations cannot be replayed to rejoin after removal. New invitations may be created after decline/expiry or after a previously accepted member leaves.

## Task management

### Model and integrity

`Task` has UUID id, title, nullable description, status, priority, nullable dueDate/completedAt, required project/creator, optional assignee, and creation/update timestamps. Status is TODO (default), IN_PROGRESS, or COMPLETED. Priority is LOW, MEDIUM (default), HIGH, or URGENT. The project owns its tasks and cascades deletion to them. Creator deletion is restricted to preserve provenance; assignee deletion sets assignedToId to null. Creator/assignee responses expose only id and name, never email, password, or session fields.

Indexes cover `(projectId, status)`, `(assignedToId, status)`, `(projectId, dueDate)`, `createdById`, and `(projectId, createdAt, id)`. These support common filters, default project pagination, and foreign-key lookups. Indexes for every filter/sort combination are deliberately avoided pending actual query measurements. The completion CHECK is explicit SQL, with a corresponding Prisma schema comment; retain it in future migration changes.

### Task permissions

All operations require authentication and current membership in the project's team. Permission checks live in services, and mutations use the existing transaction-scoped team row lock before re-reading task state and role.

| Action | OWNER / ADMIN | MEMBER |
| --- | --- | --- |
| Create unassigned task | Yes | Yes |
| View/list/search team tasks | Yes | Yes |
| Edit title/description/priority/dueDate | Any team task | Own created tasks only |
| Assign/reassign/unassign | Yes | No |
| Change status | Any team task | Creator or current assignee only |
| Delete | Any team task | Own created tasks only |

Creating as a MEMBER requires **omitting assignedToId entirely**; even explicit null is an assignment field and returns 403. An assignee must be a current member of the same team, checked under the same lock as task creation/assignment. Assignee status alone grants status changes, not general editing or deletion.

When a member leaves or is removed, the membership transaction clears their assignments across **all projects in that team**, including completed tasks, before deleting membership. It leaves other-team assignments, creator provenance, status, and completedAt untouched. Assignment and removal share the team lock, so a racing assignment either commits before removal and is cleared, or checks membership after removal and fails. No tasks are deleted by membership removal.

Cross-team/unknown tasks and projects return non-enumerating 404. For DELETE, a MEMBER who did not create the task also receives the same task 404. Insufficient edit/assignment/status permissions within a known team return 403. Invalid request shapes/UUIDs/dates return 400; a syntactically valid nonexistent or out-of-team assignee returns the same 422. Errors keep the existing `{"error":{"message":"..."}}` shape.

### Task REST endpoints

All examples use `Authorization: Bearer <accessToken>` and JSON bodies. Writes reject unknown fields; general task PATCH cannot change projectId, createdById, assignedToId, status, or completedAt.

| Method/path | Body or query example | Success |
| --- | --- | --- |
| POST `/api/projects/:projectId/tasks` | `{"title":"Implement authentication","description":"Add endpoints","priority":"HIGH","dueDate":"2026-12-01T10:00:00.000Z"}` | 201 `{"task":{...task fields}}` |
| GET `/api/projects/:projectId/tasks` | `?status=TODO&priority=HIGH&page=1&limit=20` | 200 `{"tasks":[...],"pagination":{"page":1,"limit":20,"total":1}}` |
| GET `/api/tasks/assigned-to-me` | `?status=IN_PROGRESS&projectId=<uuid>&search=authentication` | 200 tasks/pagination |
| GET `/api/tasks/:taskId` | None | 200 `{"task":{...}}` |
| PATCH `/api/tasks/:taskId` | `{"title":"Updated title","description":null,"priority":"URGENT","dueDate":null}` | 200 updated task |
| PATCH `/api/tasks/:taskId/assignee` | `{"assignedToId":"<member-uuid>"}` or `{"assignedToId":null}` | 200 updated task |
| PATCH `/api/tasks/:taskId/status` | `{"status":"COMPLETED"}` | 200 updated task |
| DELETE `/api/tasks/:taskId` | No body | 204 empty body |

A task response has this shape (placeholders replace generated values):

```json
{
  "task": {
    "id": "<task-uuid>",
    "title": "Implement authentication",
    "description": "Add endpoints",
    "status": "TODO",
    "priority": "HIGH",
    "dueDate": "2026-12-01T10:00:00.000Z",
    "completedAt": null,
    "projectId": "<project-uuid>",
    "assignedToId": null,
    "createdById": "<current-user-uuid>",
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>",
    "assignedTo": null,
    "createdBy": { "id": "<current-user-uuid>", "name": "Test User" }
  }
}
```

Title is trimmed, required, and 1–200 characters. Description is trimmed, nullable, and at most 5,000 characters. Empty patches are rejected. dueDate accepts null or an ISO 8601 datetime with a timezone (`Z` or numeric offset); invalid calendar dates and timezone-free local times are rejected. Years must be 0001–9999. Responses normalize dates to UTC, at millisecond precision. Past due dates are allowed; date-only deadlines are not supported.

All enum status transitions are allowed for an authorized actor. COMPLETED sets completedAt to server time; repeated COMPLETED retains the original timestamp. Reopening to TODO/IN_PROGRESS clears it; later completion records a new time. Status and completedAt change together under the team lock. A PostgreSQL CHECK additionally rejects any completed task without a timestamp or noncompleted task with one. Assigning or editing a task does not change completion state.

### Filtering, search, sorting and pagination

Project-task lists accept `status`, `priority`, `assignedToId=<uuid>`, `assignedToId=null` (unassigned), `search`, `page`, `limit`, `sortBy`, and `sortOrder`. Assigned-to-me accepts the same options except assignedToId, with optional `projectId` instead. It always filters assignments **and current team membership inside PostgreSQL**; stale/out-of-band assignments cannot expose another team's tasks. A projectId filter with no authorized matches yields an empty assigned-to-me collection. The fixed assigned-to-me route is registered before the dynamic task-ID route.

Examples:

```text
/api/projects/<uuid>/tasks?status=TODO&priority=HIGH&search=authentication&sortBy=dueDate&sortOrder=asc&page=1&limit=20
/api/projects/<uuid>/tasks?assignedToId=null&sortBy=priority&sortOrder=desc
/api/tasks/assigned-to-me?projectId=<uuid>&status=IN_PROGRESS&search=api&sortBy=updatedAt&sortOrder=desc
```

Search trims a 1–200-character string and performs case-insensitive substring matching across title OR description. Search and other filters compose using AND. Prisma parameterizes values; SQL-looking input remains data. `%`, `_`, and backslash are escaped as literal search characters, not LIKE wildcards. Search is not full-text search and may scan rows as the dataset grows.

Pagination defaults to page 1, limit 20, with limit 1–100 and page 1–100,000. sortBy accepts createdAt (default), updatedAt, dueDate, priority, or status; sortOrder is asc/desc (default desc). UUID ascending is always the secondary key, including when the primary sort descends. dueDate nulls sort **last in both directions**. Enum ascending order is LOW → MEDIUM → HIGH → URGENT and TODO → IN_PROGRESS → COMPLETED; descending reverses it. Offset pages are deterministic for a fixed dataset but can shift with concurrent writes. Counts and page data use the same authorization/filter predicates; they are not a cross-request snapshot.

### Investigating the project-creation route 404

The router mounts `/api/teams` → `/:teamId/projects` → POST `/`, with mergeParams enabled. The existing 30 collaboration tests passed before Milestone 4 changes, including POST `/api/teams/:teamId/projects`. A new direct network HTTP test verifies 201 using a literal constructed URL and reproduces the exact `{"error":{"message":"Route not found"}}` response with `/api/teams//projects`. No application routing defect was confirmed, so no unrelated route rewrite was made.

An empty PowerShell variable produces that double slash. This reproduces a possible cause; the original manual request and historical server process are unavailable, so its exact cause is unproven. At initial inspection there was no listener on configured port 3000. Use the response wrapper correctly and validate the ID before constructing the URL:

```powershell
# Use your privately obtained access token; do not print or share it.
$baseUrl = 'http://localhost:3000'
$headers = @{ Authorization = "Bearer $accessToken" }
$teamResponse = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/teams" -Headers $headers -ContentType 'application/json' -Body (@{ name = 'My team' } | ConvertTo-Json)
$teamId = $teamResponse.team.id
$parsedTeamId = [guid]::Empty
if (-not [guid]::TryParse([string]$teamId, [ref]$parsedTeamId)) { throw 'teamId must come from response.team.id' }
$projectUri = '{0}/api/teams/{1}/projects' -f $baseUrl.TrimEnd('/'), $teamId
Write-Host $projectUri
$projectResponse = Invoke-RestMethod -Method Post -Uri $projectUri -Headers $headers -ContentType 'application/json' -Body (@{ name = 'API' } | ConvertTo-Json)
$projectId = $projectResponse.project.id
```

To check a port without exposing process arguments:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
# Substitute the reported PID if a process is listening:
Get-Process -Id <PID>
```

Stop an old API in its own terminal with Ctrl+C, then run `npm.cmd run dev` from this project directory. For compiled mode, run `npm.cmd run build` before `npm.cmd start`; start does not rebuild dist. Do not terminate unrelated Node processes. Confirm `/api/health`, the port, current membership, and the exact printed URL. A route-level 404 (`Route not found`) differs from authorization/resource-level 404 (`Team not found`/`Project not found`); malformed nonempty UUIDs return 400, and missing/expired authentication returns 401.

## Tests

```powershell
npm.cmd test
```

Node's built-in test runner plus Supertest exercise actual Express routes. Database-free tests use real Argon2id and JWT cryptography, strict validation, rejected tokens (including expired JWTs), safe middleware errors, and rate limiting. No persistence mocks replace the PostgreSQL suite.

For real persistence tests, create or obtain a separate disposable PostgreSQL database with a name ending in `_test` (for example `task_tracker_auth_test`). Add its connection URL privately as `TEST_DATABASE_URL` in `.env`; it must have a different database name from DATABASE_URL. No test database is created automatically. Then run:

```powershell
npm.cmd run test:db:migrate
npm.cmd run test:integration
```

During Milestone 2, creation of `task_tracker_auth_test` on the configured server was explicitly approved. It has been reused and now has all four migrations applied. Its URL was passed only through subprocess environment variables; your `.env` was left unchanged. Add TEST_DATABASE_URL privately to rerun the suite through npm scripts.

The migration helper refuses the configured development database and applies only normal migrations to the named test database. Tests refuse the development database, generate fresh signing secrets in memory, use uniquely named fixtures, and delete only those fixtures afterward. They never truncate/reset tables. Existing coverage includes registration and uniqueness races, login, profiles, real health connectivity, hashed token persistence, rotation/reuse/expiry, simultaneous refresh, refresh/logout races, retryable logout, and deleted-user rejection. The collaboration suite adds role matrices, owner protection, self-removal, direct service authorization, invitation isolation/expiry/concurrent creation/concurrent acceptance, database uniqueness constraints, project isolation, pagination, and strict validation. Without TEST_DATABASE_URL, PostgreSQL suites are explicitly skipped; a green database-free test run does not establish persistence correctness.

## Deployment considerations

Authentication responses disable caching. Registration/login share a 20-request/15-minute IP limit; refresh/logout share 100 requests/15 minutes. Limits use an in-memory store and reset on restart. Express's default `trust proxy=false` is retained: behind a reverse proxy, configure only the known proxy addresses/hops after reviewing the deployment, or all clients may share a proxy limit. Never blindly trust forwarded IP headers. Multiple app instances require a shared rate-limit store. Consider per-account throttling, abuse monitoring, and hashing concurrency limits before production.

The JSON token contract is convenient for Postman and assumes HTTPS outside localhost. Never log token-bearing payloads. Browser localStorage/sessionStorage expose tokens to injected JavaScript; prefer keeping access tokens in memory and planning a secure HttpOnly/Secure/SameSite cookie design with CSRF protection for browser refresh tokens. That cookie flow is not implemented here. CORS is not authorization and does not protect tokens from XSS. Postman collections/environments containing tokens must remain private.

Email verification, password reset/change, signing-key rotation, session listing, distributed throttling, and immediate access-token revocation remain outside this milestone. Unique-email registration intentionally reveals that an address is registered through its required 409 response; login messages remain generic. No Git commit, push, or parent-repository metadata changes are part of this implementation.

## Actual verification

- Milestone 4 requires no additional dependencies; it reuses the installed stack.
- Prisma client generation, schema validation, application/config/test type checks, and production build passed.
- All **85 automated tests passed** with the approved isolated PostgreSQL database: 36 task integration tests, 30 collaboration integration tests, 13 authentication integration tests, and six security tests, with no skips or failures.
- Task tests cover defaults/validation, task permissions, literal network project-route regression, cross-team isolation, composed filtering/search/sorting, timestamp consistency, current-membership assignment feeds, removal cleanup, and concurrent assignment/creation/removal.
- Migration application and real health connectivity were verified against the test database. The Milestone 4 development migration remains unapplied. Keep existing private database/JWT settings; no new Milestone 4 environment variables are required.
