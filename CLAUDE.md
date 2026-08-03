# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Guitar Coach is a NestJS 11 (Express) backend for tracking guitar practice: users build **routines** from a shared **task** library, log **practice sessions**, and attach audio **recordings** stored in Google Cloud Storage. Auth is Better Auth (email/password, session cookies) via `@thallesp/nestjs-better-auth`. Data lives in Postgres via Prisma 7 (`@prisma/adapter-pg`). Redis backs three independent concerns (HTTP cache, a distributed lock, Better Auth rate limiting) and RabbitMQ carries one domain event (`routine.created`), consumed in the same process via a hybrid Nest microservice — there is no separate worker deployable. Full architecture diagram, ER diagram, and endpoint-by-endpoint curl walkthroughs live in `README.md`; this file is quick-reference guidance for working in the code, not a restatement of it.

**Feature modules** (`src/`): `config` (Zod env validation), `health` (Terminus liveness/readiness), `auth` (Better Auth wiring + Redis rate-limit storage), `users`, `tasks` (Redis-cached reads), `routines` (+ `routines/events` for the RabbitMQ producer/consumer), `practice-sessions` (+ its `recordings` sub-module), `gcp-storage` (GCS wrapper), `prisma` (`PrismaService`), `redis` (`RedisLockService`).

## Commands

```bash
npm run start:dev      # run with watch mode (default for local dev)
npm run start:debug    # watch mode with --debug
npm run build           # nest build -> dist/
npm run start:prod      # run compiled output from dist/main

npm run lint             # eslint --fix over src, apps, libs, test

npm run test             # jest unit tests (rootDir: src, matches *.spec.ts)
npm run test:watch
npm run test:cov
npm run test:e2e         # jest -c test/jest-e2e.json (matches *.e2e-spec.ts)

# single test file
npx jest src/app.controller.spec.ts
npx jest -t "test name substring"

# Prisma
npx prisma generate      # regenerate Prisma Client into src/generated/prisma after a schema change
npx prisma migrate dev   # create/apply a migration against DATABASE_URL
npx prisma studio        # browse the database (http://localhost:5555)
npx tsx prisma/seed.ts   # (re)run the idempotent dev seed script

# Docker Compose (dev overlay — API + Postgres + Redis + RabbitMQ, hot reload)
docker compose -f compose.yaml -f compose.dev.yaml up
docker compose -f compose.yaml -f compose.dev.yaml build api   # rebuild after a Prisma schema or dependency change
docker compose -f compose.yaml -f compose.prod.yaml up --build # production-shaped image
```

## Dependency management (IMPORTANT)

The app runs in `node:24-alpine` (see `Dockerfile`) but is developed on macOS. Historically, `npm install`/`npm ci` run on macOS could silently produce a `package-lock.json` that is NOT valid for `npm ci` on Alpine/musl: `unrs-resolver`'s wasm32-wasi fallback (pulled in transitively by ESLint tooling) only activates its peer deps (`@napi-rs/wasm-runtime` → `@emnapi/core`/`@emnapi/runtime`) on Linux, so a mac-generated lockfile could look fine and pass `npm ci` locally, yet fail with `EUSAGE ... Missing: @emnapi/core@x.y.z from lock file` inside Docker. This bit us three times in a row, including after "fixing" it by regenerating the lockfile inside a Linux container — a later plain macOS `npm install` would just regenerate it back to the mac-only shape and reintroduce the failure.

**Root-cause fix (already applied):** `@emnapi/core` and `@emnapi/runtime` are pinned as explicit top-level `devDependencies` in `package.json`, at the version `@napi-rs/wasm-runtime` peer-requires. This forces npm to always resolve and lock them at the top level regardless of host OS, so a normal macOS `npm install` now produces a lockfile that also satisfies `npm ci` on Linux. Do not remove these two devDependencies — they look unused (nothing in `src/` imports them) but they exist solely to keep the lockfile platform-stable.

**Still verify after any `package.json` change** (adding, removing, or bumping a dependency), before considering the task done:

```bash
npm install                 # regenerate package-lock.json normally, on macOS is fine now
docker compose -f compose.yaml -f compose.dev.yaml build api   # prove npm ci works the way the Dockerfile runs it
```

Do not treat a successful local `npm install`/`npm ci` as sufficient proof on its own — the Docker build above is the real verification. If it ever fails again with a `Missing: X from lock file` error for a new package, the fix is the same pattern: identify the transitive package whose peer dependency only activates on Linux, and pin that peer as an explicit top-level devDependency rather than re-fixing the lockfile by hand each time.

## Architecture notes

- Standard Nest module/controller/service structure; `src/main.ts` bootstraps `AppModule` via `NestFactory`, then `app.connectMicroservice(...)` + `app.startAllMicroservices()` to run the RabbitMQ `routine.created` consumer in-process alongside HTTP — don't introduce a separate worker entrypoint for new async consumers, follow this same hybrid-bootstrap pattern.
- A global `AuthGuard` (registered by `AuthModule.forRootAsync` in `app.module.ts`) protects every route by default — new controllers need a valid session automatically; opt out with `@AllowAnonymous()`, gate to admins with `@Roles(['admin'])`. Only `health/live`, `health/ready`, and `auth/*` are excluded from the global `${API_PREFIX}/${API_VERSION}` prefix.
- Unit tests (`*.spec.ts`) live alongside the code they test in `src/`; Jest's `rootDir` is `src`. E2E tests (`*.e2e-spec.ts`) live in `test/` with their own Jest config (`test/jest-e2e.json`).
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`. Notable rule overrides: `no-explicit-any` off, `no-floating-promises` and `no-unsafe-argument` are `warn` not `error`.
- TypeScript config targets ES2023, uses `nodenext` module resolution, and has `noImplicitAny: false` with `strictNullChecks: true` (not full `strict` mode).

## Coding conventions to follow

- **Validation**: request bodies/queries are DTO classes with `class-validator` decorators; the global `ValidationPipe` (`main.ts`) has `whitelist: true, forbidNonWhitelisted: true, transform: true` — unknown properties are rejected, not stripped-and-ignored. Partial-update DTOs use `PartialType()` (see `UpdateUserDto`/`UpdateTaskDto`), not hand-duplicated optional fields.
- **Prisma error translation**: services catch Prisma's own error codes and rethrow as Nest HTTP exceptions rather than letting them leak — `P2025` (not found) → `NotFoundException`, `P2002` (unique violation) → `ConflictException`, `P2003` (FK violation, e.g. deleting a `Task` still referenced by a `RoutineTask`) → `ConflictException`/`NotFoundException` depending on context. There's no shared exception filter for this; each service does it locally via a small `isPrismaErrorCode` helper — match that pattern rather than adding a global filter.
- **Ownership checks, not just auth**: every user-scoped resource (`routines`, `practice-sessions`, `recordings`) is fetched through a `findById(userId, id)`-style guard (or a Prisma `where: { id, userId }`) before any nested operation, and a missing/not-owned resource returns `404`, never `403` — this intentionally avoids leaking existence to non-owners. Follow this for any new user-scoped resource.
- **Fail-open vs. fail-closed for infra dependencies**: Redis-backed cache (`tasks`) and Better Auth rate-limit storage catch their own errors and degrade silently (log + treat as a miss) — a Redis outage must never break a request. The routine-reorder distributed lock (`RedisLockService`) is the deliberate exception: lock-acquire failure returns `503`, because proceeding without the lock risks corrupting task ordering. When adding new Redis-backed features, default to fail-open unless correctness genuinely requires fail-closed like the lock does.
- **Async domain events are fire-and-forget**: `RoutineCreatedProducer.publish(...)` is called after the DB write commits and wrapped in try/catch purely against a synchronous throw — a broker outage must never fail the HTTP request. Follow this pattern (publish after commit, never await-and-fail-on-publish-error) for any new event.
- **Controllers stay thin**: business logic, ownership checks, and Prisma-error translation live in the service; controllers just wire DTOs/guards/decorators to service calls.

## Key file pointers

- `prisma/schema.prisma` — full data model (models, enums, relations); `prisma/seed.ts` — idempotent dev seed data.
- `src/config/env.validation.ts` — the Zod schema that is the single source of truth for every environment variable; update this first when adding a new env var, then `.env.example`.
- `src/prisma/prisma.service.ts` — the shared `PrismaService`/`PrismaModule` (`@Global()`); reuse this rather than instantiating `PrismaClient` elsewhere.
- `src/auth/auth.ts` — Better Auth instance construction (plugins, rate limiting, email hooks); `src/auth/redis-rate-limit-storage.ts` — the Redis-backed rate-limit storage implementation.
- `src/redis/redis-lock.service.ts` — the distributed lock used by `routines`; reuse it for any new feature needing mutual exclusion instead of adding a second lock implementation.
- `src/gcp-storage/gcp-storage.service.ts` — the sole `@google-cloud/storage` wrapper (`@Global()`); reuse it rather than constructing a second `Storage` client. Note the temp-file-then-`bucket.upload()` upload path — don't revert to `file.save(buffer)` (see the comment in that file for why).
- `src/routines/events/` — the RabbitMQ producer/consumer pattern (`*.producer.ts`/`*.consumer.ts`, shared queue-options constants) to copy for any new async domain event.
- `.env.example` — annotated list of every environment variable; `compose.yaml` (base) + `compose.dev.yaml`/`compose.prod.yaml` (overlays) — Docker Compose service wiring.
- `README.md` — architecture diagram, ER diagram, full endpoint list with curl examples; read this for "how does X work end-to-end" before re-deriving it from code.

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

