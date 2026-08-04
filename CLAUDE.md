# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Guitar Coach is a NestJS 11 (Express) backend for tracking guitar practice: users build **routines** from a shared **task** library, log **practice sessions**, and attach audio **recordings** stored in Google Cloud Storage. Auth is Better Auth (email/password, session cookies) via `@thallesp/nestjs-better-auth`. Data lives in Postgres via Prisma 7 (`@prisma/adapter-pg`). Redis backs three independent concerns (HTTP cache, a distributed lock, Better Auth rate limiting) and RabbitMQ carries one domain event (`routine.created`), consumed in the same process via a hybrid Nest microservice — there is no separate worker deployable. Full architecture diagram, ER diagram, and endpoint-by-endpoint curl walkthroughs live in `README.md`; this file is quick-reference guidance for working in the code, not a restatement of it.

**Feature modules** (`src/`): `config` (Zod env validation), `health` (Terminus liveness/readiness), `auth` (Better Auth wiring + Redis rate-limit storage), `users`, `tasks` (Redis-cached reads), `routines` (+ `routines/events` for the RabbitMQ producer/consumer), `practice-sessions` (+ its `recordings` sub-module), `gcp-storage` (GCS wrapper), `prisma` (`PrismaService`), `redis` (`RedisLockService`), `weekly-routine-cleanup` (standalone Cloud Run Job entrypoint, not HTTP-facing and not registered in `AppModule` — see Architecture notes).

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

# Weekly routine cleanup job (standalone entrypoint, see Architecture notes)
npm run weekly-routine-cleanup        # run the job locally via tsx
npm run start:weekly-routine-cleanup  # run the compiled job from dist/

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

- Standard Nest module/controller/service structure; `src/main.ts` bootstraps `AppModule` via `NestFactory`, then `app.connectMicroservice(...)` + `app.startAllMicroservices()` to run the RabbitMQ `routine.created` consumer in-process alongside HTTP — don't introduce a separate worker entrypoint for new async **consumers**, follow this same hybrid-bootstrap pattern.
- **Scheduled batch jobs are a different, deliberate exception to the rule above.** A batch job (not a message consumer) *should* be its own standalone entrypoint: `src/weekly-routine-cleanup/` is the reference — its own `main.ts` using `NestFactory.createApplicationContext()` (no HTTP listener, no `AuthGuard`, no controller, since there's nothing to authorize for a batch DB job), its own minimal `env.validation.ts` Zod schema (deliberately not sharing `src/config/env.validation.ts`, to keep the job's IAM/secret footprint least-privilege), and its own `package.json` scripts. Scheduling is external — a Cloud Run Job triggered by Cloud Scheduler (see `README.md`) — don't add `@nestjs/schedule`, node-cron, or an in-process timer for a new scheduled task; follow this pattern instead unless the task genuinely needs in-process scheduling.
- A global `AuthGuard` (registered by `AuthModule.forRootAsync` in `app.module.ts`) protects every route by default — new controllers need a valid session automatically; opt out with `@AllowAnonymous()`, gate to admins with `@Roles(['admin'])`. These, along with `@Session()`, are imported directly from `@thallesp/nestjs-better-auth` — there are no local `.guard.ts`, `.decorator.ts`, or `.strategy.ts` files anywhere in `src/`; don't add or look for a local implementation. Only `health/live`, `health/ready`, and `auth/*` are excluded from the global `${API_PREFIX}/${API_VERSION}` prefix.
- Unit tests (`*.spec.ts`) live alongside the code they test in `src/`; Jest's `rootDir` is `src`. E2E tests (`*.e2e-spec.ts`) live in `test/` with their own Jest config (`test/jest-e2e.json`). See Testing conventions below for the mocking/fixture patterns to follow.
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`. Notable rule overrides: `no-explicit-any` off, `no-floating-promises` and `no-unsafe-argument` are `warn` not `error`.
- TypeScript config targets ES2023, uses `nodenext` module resolution, and has `noImplicitAny: false` with `strictNullChecks: true` (not full `strict` mode).
- **`tsx`/esbuild decorator-metadata gotcha**: files bootstrapped via `tsx` outside the normal Nest CLI build (currently only `src/weekly-routine-cleanup/main.ts`) must use explicit `@Inject(Token)` on *every* constructor parameter once any parameter has a generic-instantiated type (e.g. `ConfigService<T, true>`) — esbuild silently drops decorator metadata for the whole constructor in that case, breaking DI in ways `nest build`/ts-jest never surface. See the constructor comment in `weekly-routine-cleanup.service.ts` for the concrete example; follow it for any new standalone-bootstrap file.

## Coding conventions to follow

- **Validation**: request bodies/queries are DTO classes with `class-validator` decorators; the global `ValidationPipe` (`main.ts`) has `whitelist: true, forbidNonWhitelisted: true, transform: true` — unknown properties are rejected, not stripped-and-ignored. Partial-update DTOs use `PartialType()` (see `UpdateUserDto`/`UpdateTaskDto`), not hand-duplicated optional fields.
- **Prisma error translation**: services catch Prisma's own error codes and rethrow as Nest HTTP exceptions rather than letting them leak — `P2025` (not found) → `NotFoundException`, `P2002` (unique violation) → `ConflictException`, `P2003` (FK violation, e.g. deleting a `Task` still referenced by a `RoutineTask`) → `ConflictException`/`NotFoundException` depending on context. There's no shared exception filter for this; each service does it locally via a small `isPrismaErrorCode` helper — match that pattern rather than adding a global filter.
- **Ownership checks, not just auth**: every user-scoped resource (`routines`, `practice-sessions`, `recordings`) is fetched through a `findById(userId, id)`-style guard (or a Prisma `where: { id, userId }`) before any nested operation, and a missing/not-owned resource returns `404`, never `403` — this intentionally avoids leaking existence to non-owners. Follow this for any new user-scoped resource.
- **Fail-open vs. fail-closed for infra dependencies**: Redis-backed cache (`tasks`) and Better Auth rate-limit storage catch their own errors and degrade silently (log + treat as a miss) — a Redis outage must never break a request. The routine-reorder distributed lock (`RedisLockService`) is the deliberate exception: lock-acquire failure returns `503`, because proceeding without the lock risks corrupting task ordering. When adding new Redis-backed features, default to fail-open unless correctness genuinely requires fail-closed like the lock does.
- **Async domain events are fire-and-forget**: `RoutineCreatedProducer.publish(...)` is called after the DB write commits and wrapped in try/catch purely against a synchronous throw — a broker outage must never fail the HTTP request. Follow this pattern (publish after commit, never await-and-fail-on-publish-error) for any new event.
- **Controllers stay thin**: business logic, ownership checks, and Prisma-error translation live in the service; controllers just wire DTOs/guards/decorators to service calls.

## Naming conventions

- **Module internals**: `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`, each with a matching `<name>.controller.spec.ts`/`<name>.service.spec.ts` alongside. Sub-resources nest as subdirectories following the same convention (e.g. `practice-sessions/recordings/recordings.{controller,service}.ts`).
- **DTOs**: live in a per-module `dto/` folder, verb-first kebab-case — `create-x.dto.ts`, `update-x.dto.ts` (via `PartialType()`), query DTOs suffixed `-query.dto.ts` (e.g. `find-tasks-query.dto.ts`). There is no `entities/` folder anywhere — Prisma's generated models (`src/generated/prisma/models/`) serve that role; don't add hand-written entity classes.
- **`isPrismaErrorCode`** is intentionally duplicated verbatim in each service that needs it (`tasks.service.ts`, `routines.service.ts`, `users.service.ts`) rather than extracted to a shared util, consistent with the "no shared exception filter" guidance above. Duplicate it the same way in a new service rather than importing a shared helper.

## Testing conventions

- **Unit tests**: hand-build a typed mock object per dependency (e.g. a local `MockPrismaService` type with `jest.fn()` members) and wire it in via `Test.createTestingModule({ providers: [{ provide: PrismaService, useValue: mockPrisma }] })`. No `jest.mock()` module-level mocking, and no shared mock-factory/test-utils package — each spec defines its own local `buildX(overrides)` object builders and, where needed, a local `prismaError(code)` helper for `Prisma.PrismaClientKnownRequestError`. Match this per-file pattern rather than centralizing it.
- **Test naming**: `describe('XController (e2e)')`/`describe('XService')` outer blocks, `describe('METHOD /path')` or `describe('methodName')` nested, and `it('does specific behavior')` phrased as a behavior statement — not `it('should ...')`.
- **e2e app wiring**: `test/support/build-test-app.ts`'s `buildTestApp()` assembles a real `TestingModule` from the actual feature modules (not a hand-rolled mock module) and overrides only providers that cross an external-infra boundary: `GcpStorageService` → `FakeGcpStorageService`, `ROUTINE_EVENTS_CLIENT` → `FakeRoutineEventsClient`, and the global `AuthGuard` → `FakeAuthGuard`. Postgres and the Redis-backed reorder lock stay real (containers expected running). Follow this "swap only the network/broker boundary, keep domain logic real" pattern for any new external dependency added to a module under e2e test — see the comment in `fake-routine-events-client.ts` for why the real RabbitMQ `ClientProxy` isn't used (its lazy AMQP connect races `app.close()` teardown, producing flaky "Channel ended" rejections).
- **e2e auth**: driven by `requestAs(app, role?, userId?)` (`test/support/request-as.ts`), which sends `x-test-role`/`x-test-user-id` headers that `FakeAuthGuard` reads via the same `PUBLIC`/`OPTIONAL`/`ROLES` reflector metadata the real guard uses. Never drive e2e auth through a real Better Auth sign-in flow.
- **e2e DB lifecycle**: `test/support/global-setup.ts` validates `TEST_DATABASE_URL`, creates the DB if missing (guarding the name against SQL injection via a `SAFE_DATABASE_NAME` regex before interpolating), and runs `prisma migrate deploy` once for the whole suite. Per-spec `beforeEach` fetches `PrismaService` off the built app and `deleteMany()`s tables in FK-dependency order (children first); `afterEach` calls `app.close()`.

## Forbidden shortcuts

- Don't remove the `@emnapi/core`/`@emnapi/runtime` pinned devDependencies — see Dependency management above.
- Don't revert the GCS upload path to `file.save(buffer)` — see the comment in `gcp-storage.service.ts`.
- Don't add a shared global exception filter for Prisma errors, and don't extract `isPrismaErrorCode` into a shared util — match the existing per-service local pattern.
- Don't return `403` for a missing or not-owned user-scoped resource — always `404`, to avoid leaking existence to non-owners.
- Don't `await` a domain-event publish and fail the request on its error — publish after the DB commit, fire-and-forget, catch only against a synchronous throw.
- Don't introduce `@nestjs/schedule`, node-cron, or an in-process timer for a new scheduled task — follow the `weekly-routine-cleanup` pattern (standalone `createApplicationContext` entrypoint, scheduled externally via Cloud Run Job + Cloud Scheduler) unless the task explicitly requires in-process scheduling.
- Don't use `jest.mock()` module-level mocking or add a shared mock-factory test-utils package — hand-build typed per-spec mocks matching existing specs.
- Don't drop explicit `@Inject(Token)` constructor parameters in a `tsx`-bootstrapped standalone entrypoint once any parameter has a generic type argument — esbuild silently breaks metadata-based DI for the whole constructor in that case.
- Don't disable auth/CSRF/CORS/CSP/TLS as a default, and don't skip git hooks (`--no-verify`) to unblock a commit — fix the root cause instead.

## Key file pointers

- `prisma/schema.prisma` — full data model (models, enums, relations); `prisma/seed.ts` — idempotent dev seed data.
- `src/config/env.validation.ts` — the Zod schema that is the single source of truth for every environment variable; update this first when adding a new env var, then `.env.example`.
- `src/prisma/prisma.service.ts` — the shared `PrismaService`/`PrismaModule` (`@Global()`); reuse this rather than instantiating `PrismaClient` elsewhere.
- `src/auth/auth.ts` — Better Auth instance construction (plugins, rate limiting, email hooks); `src/auth/redis-rate-limit-storage.ts` — the Redis-backed rate-limit storage implementation.
- `src/redis/redis-lock.service.ts` — the distributed lock used by `routines`; reuse it for any new feature needing mutual exclusion instead of adding a second lock implementation.
- `src/gcp-storage/gcp-storage.service.ts` — the sole `@google-cloud/storage` wrapper (`@Global()`); reuse it rather than constructing a second `Storage` client. Note the temp-file-then-`bucket.upload()` upload path — don't revert to `file.save(buffer)` (see the comment in that file for why).
- `src/routines/events/` — the RabbitMQ producer/consumer pattern (`*.producer.ts`/`*.consumer.ts`, shared queue-options constants) to copy for any new async domain event.
- `src/weekly-routine-cleanup/` — the standalone scheduled-batch-job pattern (own `main.ts`/`env.validation.ts`) to copy for any new scheduled job; see Architecture notes.
- `test/support/build-test-app.ts` — the e2e `TestingModule` builder and its infra-boundary overrides (`FakeGcpStorageService`, `FakeRoutineEventsClient`, `FakeAuthGuard`); see Testing conventions.
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

