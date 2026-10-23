# Task Tracker API

Milestone 2: secure authentication and profile management, retaining the Milestone 1 foundation. No tasks, teams, or AI features.

## Stack and configuration

- Node.js **22.13.0**, npm, Express **5**, TypeScript **5.9.3**, PostgreSQL **17.2**.
- Prisma CLI, `@prisma/client`, and `@prisma/adapter-pg` are all pinned to **7.10.1**. This stable release supports Node 22.13.0. The registry default at setup time was an incompatible Prisma 8 release candidate, so it was deliberately avoided.
- Prisma 7 uses `prisma.config.ts` for the CLI connection URL, explicit dotenv loading, and the stable `prisma-client` generator with an explicit output directory. Runtime connections use `PrismaPg`, not the old engine configuration. See [Prisma requirements](https://www.prisma.io/docs/orm/reference/system-requirements) and [Prisma configuration](https://www.prisma.io/docs/orm/reference/prisma-config-reference).
- ESM with NodeNext resolution and strict TypeScript checks. Local imports end in `.js` so compiled JavaScript runs directly in Node. The generated client also uses `.js` imports.
- Exact direct dependency versions are in `package.json`; `package-lock.json` locks the dependency tree. Use `npm.cmd ci` for subsequent installs.

## Structure

```text
prisma/
  schema.prisma              # User and RefreshSession
  migrations/                # Initial migration and forward authentication migration
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
  shared/app-error.ts        # Expected application errors
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
# Review prisma/migrations/20261024000100_auth_sessions/migration.sql first.
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

The existing database was inspected read-only and had zero User rows at implementation time. The authentication migration adds required `passwordHash` without a default, creates RefreshSession, and runs in a transaction. It does not reset tables or invent passwords. If User rows exist when you apply it, PostgreSQL rejects the required column and rolls back. Stop and plan a staged nullable-column/account-enrollment migration; do not delete users or accept a reset to get past it. Previously existing mixed-case emails would also need a deliberate normalization/conflict review in that scenario.

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

During implementation, creation of `task_tracker_auth_test` on the configured server was explicitly approved. That database now exists with both migrations applied. Its URL was passed only through subprocess environment variables; your `.env` was left unchanged. Add TEST_DATABASE_URL privately to rerun the suite through npm scripts.

The migration helper refuses the configured development database and applies only normal migrations to the named test database. Tests refuse the development database, generate fresh signing secrets in memory, use uniquely named fixtures, and delete only those fixtures afterward. They never truncate/reset tables. The suite covers registration and uniqueness races, login, profiles, real health connectivity, hashed token persistence, rotation/reuse/expiry, simultaneous refresh, refresh/logout races, retryable logout, and deleted-user rejection. Without TEST_DATABASE_URL, the suite is explicitly skipped; a green database-free test run does not establish persistence correctness.

## Deployment considerations

Authentication responses disable caching. Registration/login share a 20-request/15-minute IP limit; refresh/logout share 100 requests/15 minutes. Limits use an in-memory store and reset on restart. Express's default `trust proxy=false` is retained: behind a reverse proxy, configure only the known proxy addresses/hops after reviewing the deployment, or all clients may share a proxy limit. Never blindly trust forwarded IP headers. Multiple app instances require a shared rate-limit store. Consider per-account throttling, abuse monitoring, and hashing concurrency limits before production.

The JSON token contract is convenient for Postman and assumes HTTPS outside localhost. Never log token-bearing payloads. Browser localStorage/sessionStorage expose tokens to injected JavaScript; prefer keeping access tokens in memory and planning a secure HttpOnly/Secure/SameSite cookie design with CSRF protection for browser refresh tokens. That cookie flow is not implemented here. CORS is not authorization and does not protect tokens from XSS. Postman collections/environments containing tokens must remain private.

Email verification, password reset/change, signing-key rotation, session listing, distributed throttling, and immediate access-token revocation remain outside this milestone. Unique-email registration intentionally reveals that an address is registered through its required 409 response; login messages remain generic. No Git commit, push, or parent-repository metadata changes are part of this implementation.

## Actual verification

- Installed dependencies with zero reported npm vulnerabilities.
- Prisma client generation, schema validation, application/config/test type checks, and production build passed.
- All **19 automated tests passed** with the approved isolated PostgreSQL database: 13 integration tests and six security tests, with no skips or failures.
- Test migrations and real health connectivity were verified against the test database. The development migration remains unapplied, and development startup still needs private JWT environment configuration.
