# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is a Nest CLI **monorepo** with two independently-deployable applications under `apps/`:

- `apps/guitar-coach` — the main HTTP API (Postgres/Prisma, Redis, RabbitMQ producer, Better Auth). This is what most feature work targets. Feature modules: `users`, `tasks`, `routines` (core domains), plus `auth`, `health`, `config`, `redis`, `prisma`, `activity-feed` (RabbitMQ producer + `GET /api/v1/activity-feed`).
- `apps/activity-feed-service` — a pure NestJS microservice (`NestFactory.createMicroservice()`, no HTTP server) that consumes `routine.created` off RabbitMQ and persists activity-feed entries to MongoDB, plus answers `activity-feed.get-by-user` RPC queries from the main API.

There is no shared `libs/` — each app owns its own copy of any cross-app contract it depends on (e.g. the `routine.created` event shape is duplicated, not imported across apps).

Feature specs live under `docs/specs/` (e.g. `docs/specs/activity-feed-service.md` — the original spec for the activity-feed feature).

## Commands

```bash
# apps/guitar-coach (main API) — no project name needed, it's the default project
npm run start           # nest start, no watch (rarely used — start:dev is the default for local dev)
npm run start:dev      # run with watch mode (default for local dev)
npm run start:debug    # watch mode with --debug
npm run build           # nest build -> dist/apps/guitar-coach
npm run start:prod      # run compiled output from dist/apps/guitar-coach/main

# apps/activity-feed-service — explicit project name required
npm run start:dev:activity-feed-service
npm run start:debug:activity-feed-service
npm run build:activity-feed-service       # nest build activity-feed-service -> dist/apps/activity-feed-service
npm run start:prod:activity-feed-service  # node dist/apps/activity-feed-service/main

npm run lint             # eslint --fix over apps, libs, test (covers both apps)
npm run format           # prettier --write over apps/**/*.ts

npm run test             # jest unit tests (rootDir: ".", roots: apps/ — covers both apps' *.spec.ts)
npm run test:watch
npm run test:cov
npm run test:debug       # jest --runInBand under node --inspect-brk, for debugging a stuck/failing test
npm run test:e2e         # jest -c apps/guitar-coach/test/jest-e2e.json (main API only; activity-feed-service has no e2e harness — see below)

# single test file
npx jest apps/guitar-coach/src/app.controller.spec.ts
npx jest -t "test name substring"

# database (Prisma, main API only)
npm run db:seed          # tsx prisma/seed.ts — also wired as `"prisma": {"seed": ...}` so `npx prisma db seed` works too
npm run db:reset          # prisma migrate reset
```

`prepare: "husky || true"` runs on `npm install` to install git hooks.

Note: `npx jest <path>` bypasses the `NODE_OPTIONS=--experimental-vm-modules` flag that `npm run test`/`npm run test:e2e` set — some controller specs (anything importing `@thallesp/nestjs-better-auth`, an ESM-only package) will fail to parse without it. Prefer `npm run test -- <pattern>` / `npm run test:e2e -- -t "..."` over raw `npx jest` when scoping to a subset.

## Dependency management (IMPORTANT)

The app runs in `node:24-alpine` (see `Dockerfile`) but is developed on macOS. Historically, `npm install`/`npm ci` run on macOS could silently produce a `package-lock.json` that is NOT valid for `npm ci` on Alpine/musl: `unrs-resolver`'s wasm32-wasi fallback (pulled in transitively by ESLint tooling) only activates its peer deps (`@napi-rs/wasm-runtime` → `@emnapi/core`/`@emnapi/runtime`) on Linux, so a mac-generated lockfile could look fine and pass `npm ci` locally, yet fail with `EUSAGE ... Missing: @emnapi/core@x.y.z from lock file` inside Docker. This bit us three times in a row, including after "fixing" it by regenerating the lockfile inside a Linux container — a later plain macOS `npm install` would just regenerate it back to the mac-only shape and reintroduce the failure.

**Root-cause fix (already applied):** `@emnapi/core` and `@emnapi/runtime` are pinned as explicit top-level `devDependencies` in `package.json`, at the version `@napi-rs/wasm-runtime` peer-requires. This forces npm to always resolve and lock them at the top level regardless of host OS, so a normal macOS `npm install` now produces a lockfile that also satisfies `npm ci` on Linux. Do not remove these two devDependencies — they look unused (nothing in `src/` imports them) but they exist solely to keep the lockfile platform-stable.

**Still verify after any `package.json` change** (adding, removing, or bumping a dependency), before considering the task done:

```bash
npm install                 # regenerate package-lock.json normally, on macOS is fine now
docker compose -f compose.yaml -f compose.dev.yaml build api activity-feed-service   # prove npm ci works the way the Dockerfile runs it, for both apps sharing this lockfile/image
```

Do not treat a successful local `npm install`/`npm ci` as sufficient proof on its own — the Docker build above is the real verification. If it ever fails again with a `Missing: X from lock file` error for a new package, the fix is the same pattern: identify the transitive package whose peer dependency only activates on Linux, and pin that peer as an explicit top-level devDependency rather than re-fixing the lockfile by hand each time.

## Architecture notes

- Standard Nest module/controller/service structure in both apps; `apps/guitar-coach/src/main.ts` bootstraps `AppModule` via `NestFactory.create()` (HTTP); `apps/activity-feed-service/src/main.ts` bootstraps via `NestFactory.createMicroservice()` (RabbitMQ only, no HTTP server, no `app.connectMicroservice()`).
- Unit tests (`*.spec.ts`) live alongside the code they test under each app's `src/`; Jest's `rootDir` is `.` with `roots: ["<rootDir>/apps/"]`, so `npm run test` picks up both apps. E2E tests (`*.e2e-spec.ts`) live in `apps/guitar-coach/test/` with their own Jest config (`apps/guitar-coach/test/jest-e2e.json`) — `activity-feed-service` has no e2e harness; its live integration (RabbitMQ + MongoDB) is verified manually via `docker compose`, not automated.
- RabbitMQ: main API publishes `routine.created` via `ClientProxy.emit()` (`ACTIVITY_FEED_CLIENT`, registered in `apps/guitar-coach/src/activity-feed/activity-feed.module.ts`) and calls `activity-feed.get-by-user` via `ClientProxy.send()` from `GET /api/v1/activity-feed`. Both patterns are carried over one durable queue, `activity_feed_queue`, owned/consumed solely by `activity-feed-service`.
- MongoDB is used only by `activity-feed-service` (via `@nestjs/mongoose`) — the main API remains Postgres/Prisma-only.
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`. Notable rule overrides: `no-explicit-any` off, `no-floating-promises` and `no-unsafe-argument` are `warn` not `error`.
- TypeScript config targets ES2023, uses `nodenext` module resolution, and has `noImplicitAny: false` with `strictNullChecks: true` (not full `strict` mode). Each app has its own `tsconfig.app.json` (extending the shared root `tsconfig.json`) referenced from `nest-cli.json`'s `projects` map.
- Redis has three independent consumers in `apps/guitar-coach`: `auth/redis-rate-limit-storage.ts` (Better Auth rate-limit `customStorage`, fail-open on Redis errors); `redis/redis-lock.service.ts` (`RedisLockService`, a generic SET-NX-PX + Lua-CAS distributed lock used by `routines.service.ts` to serialize the reorder-tasks endpoint, fails *safe* by rejecting the request if the lock can't be acquired); and `CacheModule`/`@keyv/redis` registered in `app.module.ts`, used by `tasks/tasks.service.ts` for versioned task-list cache invalidation, fail-open on cache errors.
- Better Auth's `admin()` plugin is enabled in `auth/auth.ts`, backing role/ban fields (`role`, `banned`, `banReason`, `banExpires`, `impersonatedBy`) on the Prisma `User` model.
- `prisma/schema.prisma` models: `User`, `Task`, `Routine`, `RoutineTask` (app domain) plus `Session`, `Account`, `Verification` (Better Auth-owned).
- `apps/guitar-coach/test/jest-e2e.json` runs with `maxWorkers: 1` and a `globalSetup` (`apps/guitar-coach/test/support/global-setup.ts`) for sequential, e2e-safe setup.
- `compose.dev.yaml` defines `develop.watch` sync/rebuild rules for local dev; the `api` container runs `prisma migrate deploy` before start.

# Repository Working Instructions

Before making changes:

* Inspect the repository structure and relevant existing implementation.
* Review at least one similar feature before creating a new pattern.
* Check the Prisma schema and reuse the existing `PrismaService`.
* Follow existing conventions for folders, naming, modules, controllers, services, DTOs, validation, error handling, and tests.

While implementing:

* Prefer existing utilities, abstractions, and dependencies.
* Do not introduce a new library unless the current stack cannot reasonably support the requirement.
* Keep controllers thin and place business logic in the appropriate service or existing application layer.
* Do not modify the Prisma schema unless the task requires it.
* Avoid unrelated refactoring.

Before completing the task:

* Run the repository’s relevant formatting, linting, type-checking, unit-test, and E2E-test commands.
* Do not claim a command passed unless it was actually executed successfully.
* Summarize:

  * Files created or modified
  * Important implementation decisions
  * Commands executed and their results
  * Assumptions, limitations, or unresolved issues

