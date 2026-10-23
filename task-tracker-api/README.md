# Task Tracker API

Milestone 1: project foundation only. No authentication, tasks, teams, or AI features.

## Stack and configuration

- Node.js **22.13.0**, npm, Express **5**, TypeScript **5.9.3**, PostgreSQL **17.2**.
- Prisma CLI, `@prisma/client`, and `@prisma/adapter-pg` are all pinned to **7.10.1**. This stable release supports Node 22.13.0. The registry default at setup time was an incompatible Prisma 8 release candidate, so it was deliberately avoided.
- Prisma 7 uses `prisma.config.ts` for the CLI connection URL, explicit dotenv loading, and the stable `prisma-client` generator with an explicit output directory. Runtime connections use `PrismaPg`, not the old engine configuration. See [Prisma requirements](https://www.prisma.io/docs/orm/reference/system-requirements) and [Prisma configuration](https://www.prisma.io/docs/orm/reference/prisma-config-reference).
- ESM with NodeNext resolution and strict TypeScript checks. Local imports end in `.js` so compiled JavaScript runs directly in Node. The generated client also uses `.js` imports.
- Exact direct dependency versions are in `package.json`; `package-lock.json` locks the dependency tree. Use `npm.cmd ci` for subsequent installs.

## Structure

```text
prisma/
  schema.prisma              # Initial User model
  migrations/                # Created by the first confirmed migration
prisma.config.ts             # Prisma CLI configuration
src/
  config/
    env.ts                   # Validates settings without printing secrets
    database.ts              # Shared Prisma Client and PostgreSQL pool
  generated/prisma/          # Generated locally; ignored by Git
  middleware/
    not-found.ts
    error-handler.ts
  modules/
    health/health.routes.ts
  app.ts                     # Express middleware and routes
  server.ts                  # Database startup, HTTP server, shutdown
```

A small modular monolith: shared configuration and middleware, with routes grouped by feature. The health route queries Prisma directly; no repository abstraction is needed. `User` has a UUID id, name, unique email, and timezone-aware creation/update timestamps. No user endpoints are exposed yet.

## Local setup (PowerShell)

Use `npm.cmd` to avoid Windows PowerShell execution-policy restrictions on `npm.ps1`.

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
code .env
```

Set `DATABASE_URL` to confirmed credentials for your existing PostgreSQL 17.2 database. Percent-encode special characters in credentials. Keep `.env` private. `PORT` defaults to 3000; `NODE_ENV` defaults to development; `CORS_ORIGIN` defaults to `http://localhost:5173` and allows one frontend origin.

No database is automatically created or migrated during installation, generation, or application startup. Before running the migration below, confirm the database host/name and that it is an intended development database. Prisma Migrate can offer to create a missing database and needs a shadow database to detect drift; this may require PostgreSQL `CREATEDB` privileges. Review any reset prompt before accepting it.

```powershell
npm.cmd run prisma:generate
npm.cmd run typecheck
npm.cmd run prisma:validate
# Only after confirming the target development database:
npm.cmd run prisma:migrate -- --name init
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
| `npm.cmd run typecheck` | Check application and Prisma config types |
| `npm.cmd run build` | Generate Prisma Client and compile to dist |
| `npm.cmd start` | Run compiled server |
| `npm.cmd run prisma:generate` | Generate client; no database connection required |
| `npm.cmd run prisma:validate` | Validate Prisma schema |
| `npm.cmd run prisma:migrate -- --name init` | Create and apply a development migration |
| `npm.cmd run prisma:migrate:deploy` | Apply previously committed migrations |
| `npm.cmd run prisma:studio` | Open Prisma Studio against the configured database |

CLI configuration permits an absent DATABASE_URL for offline client generation. Database commands require a real URL, and application startup always validates it. Commit schema migrations once reviewed; do not commit generated client files, build output, or secrets.

## Verification boundary

Setup verification passed: dependency installation (zero reported vulnerabilities), `prisma:generate`, `prisma:validate`, `typecheck`, and `build`. Temporary HTTP smoke checks passed for mocked database success/failure responses, JSON 404/400/413, and rejection of invalid environment settings without revealing values. These smoke checks did not connect to PostgreSQL.

Database migrations and a successful database-backed health response require confirmed local connection details. They must be tested locally after configuration; schema generation and type checking alone do not establish database connectivity.
