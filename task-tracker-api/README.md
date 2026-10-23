# Task Tracker API

Milestone 3: teams, membership, invitations, projects, and role-based authorization, preserving the authentication and project foundation. No tasks, comments, attachments, notifications, or AI features.

## Stack and configuration

- Node.js **22.13.0**, npm, Express **5**, TypeScript **5.9.3**, PostgreSQL **17.2**.
- Prisma CLI, `@prisma/client`, and `@prisma/adapter-pg` are all pinned to **7.10.1**. This stable release supports Node 22.13.0. The registry default at setup time was an incompatible Prisma 8 release candidate, so it was deliberately avoided.
- Prisma 7 uses `prisma.config.ts` for the CLI connection URL, explicit dotenv loading, and the stable `prisma-client` generator with an explicit output directory. Runtime connections use `PrismaPg`, not the old engine configuration. See [Prisma requirements](https://www.prisma.io/docs/orm/reference/system-requirements) and [Prisma configuration](https://www.prisma.io/docs/orm/reference/prisma-config-reference).
- ESM with NodeNext resolution and strict TypeScript checks. Local imports end in `.js` so compiled JavaScript runs directly in Node. The generated client also uses `.js` imports.
- Exact direct dependency versions are in `package.json`; `package-lock.json` locks the dependency tree. Use `npm.cmd ci` for subsequent installs.

## Structure

```text
prisma/
  schema.prisma              # Users, refresh sessions, teams, invitations, projects
  migrations/                # Forward-only foundation/auth/collaboration migrations
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
# prisma/migrations/20261024000200_teams_invitations_projects/migration.sql
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

During Milestone 2, creation of `task_tracker_auth_test` on the configured server was explicitly approved. It has been reused for Milestone 3 and now has all three migrations applied. Its URL was passed only through subprocess environment variables; your `.env` was left unchanged. Add TEST_DATABASE_URL privately to rerun the suite through npm scripts.

The migration helper refuses the configured development database and applies only normal migrations to the named test database. Tests refuse the development database, generate fresh signing secrets in memory, use uniquely named fixtures, and delete only those fixtures afterward. They never truncate/reset tables. Existing coverage includes registration and uniqueness races, login, profiles, real health connectivity, hashed token persistence, rotation/reuse/expiry, simultaneous refresh, refresh/logout races, retryable logout, and deleted-user rejection. The collaboration suite adds role matrices, owner protection, self-removal, direct service authorization, invitation isolation/expiry/concurrent creation/concurrent acceptance, database uniqueness constraints, project isolation, pagination, and strict validation. Without TEST_DATABASE_URL, PostgreSQL suites are explicitly skipped; a green database-free test run does not establish persistence correctness.

## Deployment considerations

Authentication responses disable caching. Registration/login share a 20-request/15-minute IP limit; refresh/logout share 100 requests/15 minutes. Limits use an in-memory store and reset on restart. Express's default `trust proxy=false` is retained: behind a reverse proxy, configure only the known proxy addresses/hops after reviewing the deployment, or all clients may share a proxy limit. Never blindly trust forwarded IP headers. Multiple app instances require a shared rate-limit store. Consider per-account throttling, abuse monitoring, and hashing concurrency limits before production.

The JSON token contract is convenient for Postman and assumes HTTPS outside localhost. Never log token-bearing payloads. Browser localStorage/sessionStorage expose tokens to injected JavaScript; prefer keeping access tokens in memory and planning a secure HttpOnly/Secure/SameSite cookie design with CSRF protection for browser refresh tokens. That cookie flow is not implemented here. CORS is not authorization and does not protect tokens from XSS. Postman collections/environments containing tokens must remain private.

Email verification, password reset/change, signing-key rotation, session listing, distributed throttling, and immediate access-token revocation remain outside this milestone. Unique-email registration intentionally reveals that an address is registered through its required 409 response; login messages remain generic. No Git commit, push, or parent-repository metadata changes are part of this implementation.

## Actual verification

- Milestone 3 requires no additional dependencies; it reuses the installed stack.
- Prisma client generation, schema validation, application/config/test type checks, and production build passed.
- All **49 automated tests passed** with the approved isolated PostgreSQL database: 30 collaboration integration tests, 13 authentication integration tests, and six security tests, with no skips or failures.
- Migration application and real health connectivity were verified against the test database. The Milestone 3 development migration remains unapplied. Keep existing private database/JWT settings; no new Milestone 3 environment variables are required.
