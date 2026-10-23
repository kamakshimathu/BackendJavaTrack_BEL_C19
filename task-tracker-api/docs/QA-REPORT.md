# Milestone 6: final QA and submission readiness

Local verification: 24 October 2026, Windows, Node 22.13.0, PostgreSQL 17.2. Scope: existing assignment features, focused fixes, documentation, and CI. No optional enhancements, commit, push, PR creation, merge, remote change, or development data mutation was performed.

## A. Executive summary

The required MVP user stories are implemented and covered by actual PostgreSQL/API tests. Final results: **124 distinct tests passed, 0 failed, 0 skipped** (119 security/integration + 5 compiled runtime). The original 116-test suite was rerun successfully before modifications. The application is ready for code review and submission preparation; hosted CI and PR/merge remain manual.

The approved fresh `task_tracker_qa_test` was created on the configured server after confirming it did not exist. It had zero public tables before all five migrations were applied. Development was inspected read-only and already has all five migrations, including Milestone 5. Existing `.env` was preserved. The QA database remains available; it was not dropped.

## B. Requirements coverage matrix

Paths below are relative to `/api`. Test references are in `tests/`; named scenarios identify actual assertions rather than merely counting routes.

| Required user story | Endpoint / implementation | Corresponding tests | Status |
| --- | --- | --- | --- |
| Register | POST `/auth/register`; normalized email, unique constraint, Argon2id | auth.integration: successful registration, duplicate/concurrent registration, invalid registration; security: hashing/schema checks | Complete |
| Secure login | POST `/auth/login`; generic errors, signed access JWT, hashed refresh session | auth.integration: login/hash persistence, identical incorrect/missing-account errors; security: rejected JWT claims/signatures | Complete |
| View/update profile | GET/PATCH `/users/me`; name-only update | auth.integration: current profile, name update, protected fields, unknown query; security: unauthenticated rejection | Complete |
| Create task | POST `/projects/{projectId}/tasks` | tasks.integration: MEMBER defaults, OWNER optional fields, explicit null, direct network URL, invalid/cross-team input | Complete |
| List assigned tasks | GET `/tasks/assigned-to-me` | tasks.integration: fixed route, current teams, stale assignment exclusion, filters | Complete |
| Complete task | PATCH `/tasks/{taskId}/status`, status COMPLETED | tasks.integration: role checks, server timestamp/idempotence/reopen, concurrent completion and SQL CHECK | Complete |
| Assign teammate | PATCH `/tasks/{taskId}/assignee`; managers only | tasks.integration: assign/reassign/unassign, nonmember 422, removal races, assigned creation/removal race | Complete |
| Filter by status | Both task list endpoints, `status` query | tasks.integration: composed filters, invalid values, personal feed | Complete |
| Search title/description | Both task lists, literal case-insensitive `search` | tasks.integration: title/description matches, SQL payloads and LIKE wildcard escaping | Complete |
| Add comments | POST `/tasks/{taskId}/comments` plus list/edit/delete | discussion.integration: content validation, author/moderation permissions, membership isolation, pagination | Complete |
| Add attachments | POST `/tasks/{taskId}/attachments` plus list/download/delete | discussion.integration: actual disk bytes, format/size/name checks, private reads, authorization, cleanup failures/cascades | Complete |
| Create teams/projects | POST `/teams`, `/teams/{teamId}/projects` | collaboration.integration: atomic OWNER, project manager permissions/isolation; tasks.integration: direct HTTP project and task creation | Complete |
| Invite teammates | POST `/teams/{teamId}/invitations`; GET `/invitations`; accept/decline | collaboration.integration: intended email, expiry, duplicate/concurrent creation/acceptance, replay, decline | Complete (registered accounts; no email delivery/verification) |
| Secure logout | POST `/auth/logout`; revoke refresh family | auth.integration: retryability, rotation/logout race, independent simultaneous sessions, issued-access-token semantics | Complete within documented short-lived access-token contract |
| Notifications and AI | No implementation | Not applicable | Optional; not implemented |

## C. Files created or modified

Modified: `.gitignore`, `README.md`, `package.json`, `package-lock.json`; auth/health/users route files; task service; file-cleanup service; auth/discussion/security/task tests.

Created: `docs/openapi.json`, `docs/OPERATIONS.md`, this report; `scripts/generate-openapi.mjs`, `scripts/validate-docs.mjs`; `tests/runtime.test.mjs`; **parent** `.github/workflows/task-tracker-ci.yml`.

Ignored local verification artifacts: `.private/` scripts/logs and `.qa-runtime/` production install. They contain no copied `.env` and are excluded from submission. No schema or migration was changed in this milestone.

## D. Code quality and architecture

Feature routes own HTTP parsing/response wrapping; domain services enforce permissions and use Prisma. Auth and team/task authorization helpers are reused; storage is behind a small interface. Shared errors and strict schemas avoid duplicated ad hoc validation. No repository abstraction, microservices, or stylistic rewrite was introduced.

Strict TypeScript checks include noUncheckedIndexedAccess and exactOptionalPropertyTypes and cover application, Prisma configuration, and tests. ESM imports compile correctly with NodeNext. Startup does a database probe before listening; fatal lifecycle errors use generic messages. Shutdown drains HTTP, closes idle connections, disconnects Prisma, and bounds shutdown time. Logging is deliberately minimal; request correlation/structured operational telemetry is future work.

## E. Security findings and fixes

- Verified Argon2id with random salts and bounded password input; generic login errors and dummy verification for nonexistent users. Registration intentionally returns duplicate-email 409.
- JWT algorithm, header/type, issuer, audience, subject, expiry, issued-at and ID are checked. Configuration rejects absent/weak-looking hex secrets but cannot prove entropy. Refresh tokens use cryptographic randomness, SHA-256 persistence, absolute expiry, transaction-scoped family locks, rotation/replay revocation, and retryable logout.
- Authorization reads current memberships. Cross-team resources are hidden, protected fields rejected, and public selections exclude credentials. Tagged raw SQL uses bound parameters; dynamic sort fields are enum validated; substring wildcards are escaped. Test-only fixed SQL creates/drops failure-injection triggers in the guarded test database.
- JSON bodies are bounded to 100 KiB. Helmet, fixed-origin CORS, no-store headers, generic errors and in-memory authentication/upload limits are present. No credentials or error stacks are returned in health/API responses.
- Uploads authorize before parsing, accept one bounded in-memory file, check conservative names/MIME/signatures/text, generate opaque keys, and use private disk. Storage validates keys and avoids path traversal. Downloads are authorized and force attachment/no-store/nosniff/sandbox headers. Signatures do not prove absence of malware.
- **Fixed cleanup queue starvation:** failed old jobs defer 60 seconds so bounded runs can reach later work. Added failure/recovery fairness and simultaneous-worker tests. Queue records survive failure; physical deletion is not described as a database transaction.
- Authentication, profile, and health now reject unknown query parameters consistently; added regression assertions.
- Compiled cleanup now uses native Node instead of the development-only tsx runner.

Multer is pinned to **2.5.0**. Its official advisory listing was reviewed against this installed version; no newer applicable advisory was found during this audit. Source: [Multer security advisories](https://github.com/expressjs/multer/security/advisories). No dependency security patch or force upgrade was necessary.

Secret review compared configured private URL/password/JWT values without printing them and checked private-key/JWT patterns, tracked artifact paths, and all five project-history commits. It reviewed 197 historical project file versions. No private-value or token/key findings remained. Disposable CI settings were deliberately made distinct from local credentials. Only `.env.example` is tracked; no `.env`, private uploads, generated client, or dist files are tracked. This scoped audit is not a guarantee against every possible secret format or unrelated projects' history.

## F. Database and migrations

| Migration, in order | Review / evidence |
| --- | --- |
| 20261023144924_init | User UUID key, unique email, timestamps |
| 20261024000100_auth_sessions | Required passwordHash, refresh UUID/FK/hash uniqueness, family/user/expiry indexes; legacy populated-table caveat documented |
| 20261024000200_teams_invitations_projects | Membership uniqueness, owner/pending-invitation partial unique indexes, relationship FKs, listing indexes |
| 20261024000300_task_management | Task FKs/indexes/enums; completion consistency CHECK |
| 20261024000400_comments_attachments | Comment/attachment FKs/indexes, unique storage key, FileCleanup, AFTER DELETE queue trigger |

Fresh QA database: all five migration records finished; 11 public tables (including Prisma history), 11 primary keys, 15 foreign keys, one completion CHECK, both custom partial indexes, and attachment cleanup trigger were confirmed in PostgreSQL catalogs. UTC application sessions were verified. Integration tests actually reject inconsistent completion/uniqueness and exercise cleanup triggers through parent cascades.

Development catalog independently confirms all five finished migrations and custom indexes/trigger; Milestone 5 is **not pending** in this workspace. No development migration/reset/write was run. Assignment membership, ownerId agreement, and retaining at least one owner depend on service transactions; arbitrary privileged SQL can bypass these invariants. Timestamp consistency is tested; pre-correction historical values were not rewritten. Common joins/ordered feeds have indexes; large substring searches need a separate query-plan/performance review.

## G. API consistency

Reviewed all 38 operations and route registration. `/tasks/assigned-to-me` precedes UUID routes. Direct network requests cover both `/teams/{teamId}/projects` and `/projects/{projectId}/tasks`; an empty team ID reproduces the malformed-URL 404. Documentation uses the actual routes.

MEMBER creation with explicit `assignedToId:null` now behaves like omission; assigning any non-null user still returns 403. OWNER/ADMIN assignment requires a current teammate, otherwise 422. ADMIN self-removal remains 403: changing that would alter the existing role contract. OWNER can demote them to MEMBER before voluntary departure.

Responses retain named envelopes, sanitized fields, UTC dates, bounded page/limit metadata, stable UUID ordering, and safe errors. Count/list operations at default transaction isolation are not a guaranteed consistent snapshot. POST invitation actions permit no body or `{}`; optional idempotence/expiry semantics are documented. Expected 404 and 403 distinctions and logical deletion semantics remain explicit.

## H. Tests and commands

| Suite | Original | Final passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| security.test.ts | 6 | 6 | 0 | 0 |
| auth.integration.test.ts | 13 | 14 | 0 | 0 |
| collaboration.integration.test.ts | 30 | 30 | 0 | 0 |
| tasks.integration.test.ts | 36 | 36 | 0 | 0 |
| discussion.integration.test.ts | 31 | 33 | 0 | 0 |
| runtime.test.mjs | 0 | 5 | 0 | 0 |
| **Total** | **116** | **124** | **0** | **0** |

Eight new distinct tests: two cleanup tests, one independent-session test, and five compiled runtime tests. Existing tests were strengthened for explicit null, direct HTTP task creation, and unknown query rejection. All 119 main tests ran against the approved fresh QA database. The five runtime tests also passed separately with the production-only install; this repeated execution is not counted as five additional distinct tests.

Executed successfully: final-lockfile `npm.cmd ci`; `prisma:validate`; `prisma:generate` (also within build); `typecheck`; `build`; `docs:generate`; `docs:validate`; guarded `test:db:migrate`; main test runner equivalent to npm test; `test:runtime` runner; `npm.cmd ci --omit=dev --prefix .qa-runtime`; `npm.cmd audit --json`; catalog/secret checks; Git diff whitespace check. Test URLs were passed privately through process environments, not written into `.env`.

Intermediate checks caught and corrected an OpenAPI empty required-array issue and a new query assertion placed before login; final results above include those corrections. A QA run attempted while npm ci was replacing node_modules could not resolve pg; it was rerun successfully after installation. A one-off PowerShell inline-JavaScript quoting failure occurred before any database action and was replaced by a script. None of these changed development data.

Not run: hosted GitHub Actions, Linux-hosted runtime, deployment smoke tests, load/penetration testing, scheduler installation. No code-coverage percentage is claimed. Test rows/files were cleaned; a post-suite QA catalog check found zero users, teams, and cleanup jobs.

## I. Dependency audit

Final npm audit: **0 vulnerabilities** (info/low/moderate/high/critical all zero), so there are no direct/transitive or production/development vulnerability findings to classify. npm's overlapping inventory reports prod 234, dev 75, optional 41, peer 4, total 325; this is not the installed-package count. Clean install added 287 packages/audited 288. Production install added 238/audited 239, also zero vulnerabilities.

Only documentation validation tools were added: dev-only `@apidevtools/swagger-parser` **12.1.0** and `yaml` **2.9.1**. Existing runtime dependencies remain pinned. No audit fix --force or unrelated upgrade was used. Node 22.13.0 install/build/runtime compatibility was actually exercised on Windows; CI is configured for Linux but unexecuted here.

## J. Production runtime

Compiled startup, valid database health 200, invalid-environment failure without values, compiled independent cleanup, real connection-loss health 503, and successful shutdown all passed. The outage test disconnects a temporary TCP proxy, never stops PostgreSQL. Omit-dev verification copied only dist/manifest/lockfile into ignored `.qa-runtime`, installed production dependencies, and passed the same five checks; tsx was absent. npm may retain optional peer packages, so this does not claim every CLI/type package is absent.

Windows shutdown tests use IPC to invoke the application's actual SIGTERM handler; they do not claim POSIX signal delivery on Windows was tested. `npm start` maps directly to the verified native compiled entry. Existing access tokens and HTTP streams have their documented lifecycle limits.

## K. CI workflow

`../.github/workflows/task-tracker-ci.yml` is at the parent repository root, with push/PR filters for this project and itself, read-only repository permissions, project working directory, Node 22.13.0, and PostgreSQL 17.2 service. CI generates a disposable signing secret and uses distinct CI-only database credentials, requiring no external secrets. It runs ci, validate/generate, guarded migrations, docs validation, typecheck, build, both test commands, and npm audit.

YAML parses without duplicate-key errors; a structural validator verifies paths, working directory, isolated database, Node version, and required steps. Actions checkout/setup-node v7 match their official published documentation reviewed during setup. This is local syntax/structure validation, not an actionlint/hosted execution claim. No unrelated workflow was edited and no run was triggered.

## L. Documentation

README now covers reproducible PowerShell setup, private credentials and role creation, Prisma 7 choices, all endpoints, auth/permissions, pagination/search, uploads, build/runtime, tests, and limits. Static OpenAPI 3.0.3 covers all 38 operations and passes Swagger Parser validation without external references. The generator is a documentation tool only. OPERATIONS includes a manual Task Scheduler example, retention, recovery/backlog monitoring, and shared storage requirements.

## M. Remaining risks and limitations

No mailbox verification, password recovery, immediate access-token logout revocation, distributed throttling, malware scanning, storage quota, ownership transfer, or automated backups/monitoring. Local storage requires a shared mount for multiple instances. JSON token transport assumes HTTPS and careful client storage. Filesystem and PostgreSQL cannot commit atomically; cleanup/backups need operations discipline. Offset pagination and substring search have growth limits. Email, AI, frontend, and real-time notifications remain optional unimplemented features.

## N. Submission checklist / manual steps

- [x] Original and final test suites passed; no skipped database tests in reported runs.
- [x] Fresh migration history verified; development Milestone 5 confirmed applied read-only.
- [x] README, safe unchanged example environment, validated OpenAPI, and operations guide ready.
- [x] Scoped secret/artifact/history review complete; `.env` preserved and untracked.
- [x] Parent-level workflow locally validated; hosted run still pending.
- [x] Public repository/default branch confirmed through the connected GitHub repository API.
- [ ] Review diff, commit/push explicitly, open/review PR, and inspect hosted CI.
- [ ] Merge after review, then verify project accessibility on master.

Current branch is `feature/task-tracking-system`. HEAD `2ca97ba` is contained only by that local feature branch; cached `origin/master` contains no task-tracker-api tree. This proves neither a current remote merge nor hosted readiness; no fetch/remote mutation was done. The public repository is [BackendJavaTrack_BEL_C19](https://github.com/kamakshimathu/BackendJavaTrack_BEL_C19). The final **target after merge** is [master/task-tracker-api](https://github.com/kamakshimathu/BackendJavaTrack_BEL_C19/tree/master/task-tracker-api); do not submit that folder URL until it exists there.

For local reruns, privately configure TEST_DATABASE_URL for the approved QA database; no development migration is currently needed. Build before running cleanup, and schedule it manually if desired. Keep the QA database or remove it only through a separately approved operator action.

## O. Git preparation (manual only)

From the parent repository, inspect status and diff before staging. Stage only task-tracker-api and the new workflow, review the staged diff for secrets, commit, push the existing feature branch, then prepare a PR against master. See the final response for exact commands. No Git write operation was performed by this milestone.
