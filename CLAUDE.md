# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Guitar Coach is a NestJS 11 (Express) backend for tracking guitar practice: users build **routines** from a shared **task** library, log **practice sessions**, and attach audio **recordings** stored in Google Cloud Storage. Auth is Better Auth (email/password, session cookies) via `@thallesp/nestjs-better-auth`. Data lives in Postgres via Prisma 7 (`@prisma/adapter-pg`). Redis backs three independent concerns (HTTP cache, a distributed lock, Better Auth rate limiting) and RabbitMQ carries one domain event (`routine.created`, with a dead-letter queue), consumed in the same process via a hybrid Nest microservice — there is no separate worker deployable. Every request gets a correlation ID, structured JSON logging, and normalized error responses via the global `observability` module (see below); OTel metrics export to GCP Cloud Monitoring when enabled (see `docs/monitoring/README.md`). Full architecture diagram and ER diagram live in `README.md`, with endpoint-by-endpoint curl walkthroughs one page per feature under `docs/*.md` (linked from README's `## Documentation` index); this file is quick-reference guidance for working in the code, not a restatement of either.

**Feature modules** (`src/`): `config` (Zod env validation), `health` (Terminus liveness/readiness — now including Redis/RabbitMQ connectivity, see `health/indicators/`), `auth` (Better Auth wiring + Redis rate-limit storage), `users`, `tasks` (Redis-cached reads), `routines` (+ `routines/events` for the RabbitMQ producer/consumer), `practice-sessions` (+ its `recordings` sub-module; also records which `Task`s a session actually covered via `PracticeSessionTask`, and an optional link back to the `Routine` it followed), `ai-practice-planner` (OpenAI Responses API integration — structured-output plan generation, optional `web_search`, and a `create_routine` custom tool gated behind explicit user confirmation; see Coding conventions and Key file pointers below), `ai-routine-coach` (`@openai/agents` integration — a single tool-calling `RoutineCoachAgent` that gathers its own context and creates a routine directly, no confirmation step, gated by a native SDK input guardrail; see Coding conventions and Key file pointers below), `gcp-storage` (GCS wrapper), `prisma` (`PrismaService`), `redis` (`RedisLockService`), `observability` (structured logging, correlation IDs, the global exception filter, security-event logging, and the OTel metrics registry — `@Global()`, see Coding conventions and Key file pointers below), `weekly-routine-cleanup` (standalone Cloud Run Job entrypoint, not HTTP-facing and not registered in `AppModule` — see Architecture notes).

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

# Local Kubernetes (kind) — alternative to Docker Compose, see k8s/README.md
kind create cluster --name guitar-coach
docker build --target production -t guitar-coach-api:local .
kind load docker-image guitar-coach-api:local --name guitar-coach
kubectl --context kind-guitar-coach apply -k k8s/overlays/local
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
- **Scheduled batch jobs are a different, deliberate exception to the rule above.** A batch job (not a message consumer) *should* be its own standalone entrypoint: `src/weekly-routine-cleanup/` is the reference — its own `main.ts` using `NestFactory.createApplicationContext()` (no HTTP listener, no `AuthGuard`, no controller, since there's nothing to authorize for a batch DB job), its own minimal `env.validation.ts` Zod schema (deliberately not sharing `src/config/env.validation.ts`, to keep the job's IAM/secret footprint least-privilege), and its own `package.json` scripts. Scheduling is external — a Cloud Run Job triggered by Cloud Scheduler (see `docs/weekly-routine-cleanup.md`) — don't add `@nestjs/schedule`, node-cron, or an in-process timer for a new scheduled task; follow this pattern instead unless the task genuinely needs in-process scheduling.
- A global `AuthGuard` (registered by `AuthModule.forRootAsync` in `app.module.ts`) protects every route by default — new controllers need a valid session automatically; opt out with `@AllowAnonymous()`, gate to admins with `@Roles(['admin'])`. These, along with `@Session()`, are imported directly from `@thallesp/nestjs-better-auth` — there are no local `.guard.ts`, `.decorator.ts`, or `.strategy.ts` files anywhere in `src/`; don't add or look for a local implementation. Only `health/live`, `health/ready`, and `auth/*` are excluded from the global `${API_PREFIX}/${API_VERSION}` prefix.
- Unit tests (`*.spec.ts`) live alongside the code they test in `src/`; Jest's `rootDir` is `src`. E2E tests (`*.e2e-spec.ts`) live in `test/` with their own Jest config (`test/jest-e2e.json`). See Testing conventions below for the mocking/fixture patterns to follow.
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`. Notable rule overrides: `no-explicit-any` off, `no-floating-promises` and `no-unsafe-argument` are `warn` not `error`.
- TypeScript config targets ES2023, uses `nodenext` module resolution, and has `noImplicitAny: false` with `strictNullChecks: true` (not full `strict` mode).
- **`tsx`/esbuild decorator-metadata gotcha**: files bootstrapped via `tsx` outside the normal Nest CLI build (currently `src/weekly-routine-cleanup/main.ts`, which imports the `@Global()` `ObservabilityModule` for structured logging) must use explicit `@Inject(Token)` on *every* constructor parameter once any parameter has a generic-instantiated type (e.g. `ConfigService<T, true>`) — esbuild silently drops decorator metadata for the whole constructor in that case, breaking DI in ways `nest build`/ts-jest never surface. See the constructor comments in `weekly-routine-cleanup.service.ts` and `src/observability/metrics/metrics.module.ts` for concrete examples (the latter was actually caught by this exact bug during implementation — a missing `@Inject(ConfigService)` crashed the job with `Cannot read properties of undefined` under `tsx` while passing every `nest build`/ts-jest check); follow this pattern for any new standalone-bootstrap file or any module a standalone entrypoint might import.
- **CI jobs that shouldn't block the main pipeline get their own independent workflow file.** `.github/workflows/k6-performance.yml` runs on the same `pull_request`/`push`-to-`main` triggers as `ci.yml` and `google-cloudrun-docker.yml` but has no `needs:` on either — GitHub schedules independent workflows concurrently by default, so this runs in parallel with `build-and-test` rather than lengthening it. Follow this pattern (new workflow file, no `needs:`) for any future CI job that should run alongside, not after, the existing checks.
- **`@openai/agents-core` global `unhandledRejection` hijack**: importing `@openai/agents` (via `AiRoutineCoachModule`) has the side effect of installing a process-wide `process.on('unhandledRejection', ...)` listener (its `TraceProvider`, see `node_modules/@openai/agents-core/dist/tracing/provider.js`) that calls `process.exit(1)` if it's the *only* listener for that event — meaning any unhandled rejection anywhere in the app, unrelated to AI features, force-exits the whole process, and that abrupt `process.exit()` truncates unflushed logs so the real error is lost. `src/main.ts` registers its own top-level `process.on('unhandledRejection', ...)` handler specifically to defuse this exit branch (Node calls every registered listener, so the SDK's "no other listeners" check no longer holds) and guarantee the actual rejection is logged. Don't remove that handler, and don't assume an unhandled rejection during bootstrap will produce a useful log without it — this was discovered in production when enabling `METRICS_EXPORT_ENABLED` for the first time silently crashed deploys with only a generic "Unhandled rejection object" line.

## Coding conventions to follow

- **Validation**: request bodies/queries are DTO classes with `class-validator` decorators; the global `ValidationPipe` (`main.ts`) has `whitelist: true, forbidNonWhitelisted: true, transform: true` — unknown properties are rejected, not stripped-and-ignored. Partial-update DTOs use `PartialType()` (see `UpdateUserDto`/`UpdateTaskDto`), not hand-duplicated optional fields.
- **Prisma error translation**: services catch Prisma's own error codes and rethrow as Nest HTTP exceptions rather than letting them leak — `P2025` (not found) → `NotFoundException`, `P2002` (unique violation) → `ConflictException`, `P2003` (FK violation, e.g. deleting a `Task` still referenced by a `RoutineTask`) → `ConflictException`/`NotFoundException` depending on context. There's no shared exception filter for this; each service does it locally via a small `isPrismaErrorCode` helper — match that pattern rather than adding a global filter.
- **Ownership checks, not just auth**: every user-scoped resource (`routines`, `practice-sessions`, `recordings`) is fetched through a `findById(userId, id)`-style guard (or a Prisma `where: { id, userId }`) before any nested operation, and a missing/not-owned resource returns `404`, never `403` — this intentionally avoids leaking existence to non-owners. Follow this for any new user-scoped resource.
- **Bulk/filtered deletes are the one deliberate exception to "single resource, by id, 204"**: every other delete in the app (`DELETE /tasks/:id`, `DELETE /routines/:id`, `DELETE /routines/:routineId/tasks/:taskId`) is single-resource-by-id returning 204. `PracticeSessionsController.deleteByTitle` (`DELETE /practice-sessions?title=...`, added for the k6 tests' own `teardown()` cleanup, see `docs/performance-testing.md`) is the first bulk one — it stays safe by requiring a non-empty **exact**-match filter (never a wildcard/`LIKE`) via its DTO, the same ownership scoping as every other query, and returns `{ deletedCount }` (200) instead of 204 since a bulk caller benefits from knowing the count. Keep those same constraints (required exact filter, ownership-scoped, count in the response) if this pattern is ever copied for another bulk delete — don't loosen the filter to partial matching.
- **Fail-open vs. fail-closed for infra dependencies**: Redis-backed cache (`tasks`) and Better Auth rate-limit storage catch their own errors and degrade silently (log + treat as a miss) — a Redis outage must never break a request. The routine-reorder distributed lock (`RedisLockService`) is the deliberate exception: lock-acquire failure returns `503`, because proceeding without the lock risks corrupting task ordering. When adding new Redis-backed features, default to fail-open unless correctness genuinely requires fail-closed like the lock does.
- **Async domain events are fire-and-forget**: `RoutineCreatedProducer.publish(...)` is called after the DB write commits and wrapped in try/catch purely against a synchronous throw — a broker outage must never fail the HTTP request. Follow this pattern (publish after commit, never await-and-fail-on-publish-error) for any new event.
- **Controllers stay thin**: business logic, ownership checks, and Prisma-error translation live in the service; controllers just wire DTOs/guards/decorators to service calls.
- **AI/LLM provider integrations**: wrap the vendor SDK behind a small interface (e.g. `AiProvider`) bound via a DI token (`AI_PROVIDER`), and inject the vendor client itself via its own token (`OPENAI_CLIENT`) rather than constructing it inline in the implementing service — this is what lets a unit test hand-build a fake client/provider instead of reaching for `jest.mock()`, and lets e2e tests swap in a fake provider the same way `GcpStorageService`/`ROUTINE_EVENTS_CLIENT` are swapped. See `src/ai-practice-planner/openai/` for the reference implementation.
- **`@openai/agents` tool-calling integrations**: expose each tool as a plain, independently-testable handler function `(deps, userId, args) => result` plus a thin `build<Name>Tool(deps)` factory wrapping it in the SDK's `tool()`; the handler's `userId` always comes from `RunContext` (via the shared `requireUserId()` helper), never from the tool's own Zod args schema — no tool schema in `src/ai-routine-coach/tools/` declares a `userId` field. Wrap the SDK's `run()`/`withTrace()` behind a small `AgentRunner` interface bound via a DI token (`AGENT_RUNNER`, mirroring `AI_PROVIDER` above) so tests can hand-build a fake runner instead of module-mocking `@openai/agents`. A write tool signals success back to the caller through a plain object on the run's context (e.g. `context.createdRoutine`), set only after the underlying service call actually persisted — never trust the model's own final-output text for whether a write happened. See `src/ai-routine-coach/` for the reference implementation, including its native heuristic `InputGuardrail` (deliberately not a second LLM-classifier `Agent` — keep exactly one `Agent` per such integration unless a task explicitly calls for more). Input guardrails aren't Nest-managed classes (they're plain objects handed to `new Agent({...})`), so any Nest-provided dependency they need (e.g. `SecurityEventLogger`) is threaded in via a `build<Name>Guardrail(dep)` factory called from the `Agent`-constructing factory class, not via `@Injectable()` on the guardrail itself — see `routine-coach.guardrail.ts`/`routine-coach-agent.factory.ts`.
- **Structured logging, correlation IDs, and security events**: every existing `new Logger(ClassName.name)` call already emits redacted, correlation-ID-tagged JSON — `StructuredLoggerService` (`src/observability/`) replaces Nest's default logger app-wide via `app.useLogger(...)`, so don't add a second logging library or bypass it with `console.log`. Request/execution correlation lives in `RequestContext` (`AsyncLocalStorage`) — read it via `RequestContext.getRequestId()`/`getCorrelationId()` if you need it explicitly, but most code never has to. For anything security-relevant (auth outcomes, rate-limit denials, AI guardrail trips, privileged-action audit trail), inject `SecurityEventLogger` and call `.log({eventType, outcome, ...})` rather than a plain `logger.warn(...)` — this is what keeps those events in one filterable, alertable schema (`meta.eventCategory: "security"`).
- **OTel metrics**: every instrument lives in `src/observability/metrics/meters.ts` — import and call `meters.<name>.add()`/`.record()` unconditionally (it's always safe: a no-op meter until `METRICS_EXPORT_ENABLED=true`, per `MetricsModule`). Add a new instrument to `meters.ts` itself only when adding a genuinely new signal; reuse an existing one otherwise, and keep attributes low-cardinality (route templates, model/action/tool/job names, coarse outcome strings) — never raw user IDs, request IDs, or full URLs as attributes.

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
- **OTel no-op-meter gotcha in unit tests**: with `METRICS_EXPORT_ENABLED` unset/false (the default, and always true in unit tests since no `MeterProvider` is ever registered), `@opentelemetry/api`'s no-op implementation returns the *same singleton instance* for every `createCounter`/`createHistogram` call of the same instrument kind — e.g. `meters.rateLimitDeniedTotal` and `meters.redisOperationFailuresTotal` are literally the same object with `jest.spyOn`ned methods aliasing each other. A test spying on more than one same-kind instrument in one file must assert by call-signature/args rather than a bare "not called," or filter `mock.calls` by shape — see `redis-rate-limit-storage.spec.ts` for a worked example.

## Documentation maintenance

Whenever a change adds a new feature module, endpoint, environment variable, external dependency, or a notable architectural decision, update the relevant sections of **`README.md`**, the matching per-feature page in **`docs/`**, and this file (`CLAUDE.md`) as part of that same change — not as a follow-up task. Treat outdated docs as a defect in the change itself, the same way a missing test would be.

Full endpoint curl examples, provisioning scripts, and architecture-decision rationale live in `docs/*.md` (one page per feature/concern — see the `## Documentation` index in `README.md`), not inline in README; README itself holds only the architecture diagram, ER diagram, and a short teaser + link per section.

- **`docs/<feature>.md`**: add/update the endpoint's own page with curl examples (matching the style of `docs/routines.md`/`docs/practice-recordings.md`) — create a new page following that pattern if the feature doesn't have one yet. A new non-obvious design choice gets a bullet in `docs/architecture-decisions.md` (mirrors the existing bullets there).
- **`README.md`**: update the feature module bullet in Overview, the environment variables table, the architecture diagram/bullets if a new external service or integration boundary is introduced, and add/update the section's short teaser (2–4 sentences + a link to the `docs/<feature>.md` page) plus its entry in the `## Documentation` index.
- **`CLAUDE.md`**: add the new module to the Feature modules list in Project overview, a Key file pointers entry if the change introduces a reusable pattern future work should copy, and a Coding/Naming/Testing conventions bullet only if the change establishes a genuinely new convention (not just another instance of an existing one).
- Keep additions to the same terse, reference style already used in each file — a sentence or two per bullet, not a restatement of the code.
- If a change is small enough that none of these need an update (e.g. a bug fix with no new surface area), say so explicitly in the completion summary rather than silently skipping it.

## Forbidden shortcuts

- Don't remove the `@emnapi/core`/`@emnapi/runtime` pinned devDependencies — see Dependency management above.
- Don't revert the GCS upload path to `file.save(buffer)` — see the comment in `gcp-storage.service.ts`.
- Don't add a shared global exception filter for Prisma errors, and don't extract `isPrismaErrorCode` into a shared util — match the existing per-service local pattern. (`src/observability/http-exception.filter.ts` IS a global filter, but it's scoped strictly to response-shape normalization downstream of that per-service translation — it doesn't touch Prisma error codes. Don't blur that line by moving Prisma translation into it.)
- Don't return `403` for a missing or not-owned user-scoped resource — always `404`, to avoid leaking existence to non-owners.
- Don't `await` a domain-event publish and fail the request on its error — publish after the DB commit, fire-and-forget, catch only against a synchronous throw.
- Don't introduce `@nestjs/schedule`, node-cron, or an in-process timer for a new scheduled task — follow the `weekly-routine-cleanup` pattern (standalone `createApplicationContext` entrypoint, scheduled externally via Cloud Run Job + Cloud Scheduler) unless the task explicitly requires in-process scheduling.
- Don't use `jest.mock()` module-level mocking or add a shared mock-factory test-utils package — hand-build typed per-spec mocks matching existing specs.
- Don't drop explicit `@Inject(Token)` constructor parameters in a `tsx`-bootstrapped standalone entrypoint once any parameter has a generic type argument — esbuild silently breaks metadata-based DI for the whole constructor in that case.
- Don't disable auth/CSRF/CORS/CSP/TLS as a default, and don't skip git hooks (`--no-verify`) to unblock a commit — fix the root cause instead.
- Don't skip updating `README.md`/the matching `docs/*.md` page/`CLAUDE.md` for a change that adds a feature, endpoint, env var, or external dependency — see Documentation maintenance above.
- Don't log raw prompts, model responses, tool payloads/results, request/response bodies, or secrets/tokens/credentialed URLs — `StructuredLoggerService` redacts known-sensitive *keys* automatically, but it can't redact sensitive content stuffed into an arbitrary string; don't rely on it to save you from logging something you shouldn't log in the first place.
- Don't add a second metrics/logging library (Prometheus client, pino, winston, an APM agent) — the existing `StructuredLoggerService`/`meters.ts`/GCP-OTLP-export setup was chosen deliberately to avoid a new observability vendor dependency; extend what's there.
- Don't run `git stash`/`git reset`/`git checkout <ref> -- <files>` (or any other destructive git command) as a scratch workaround mid-task, especially when other work might be uncommitted in the same tree — this actually happened once during this project's observability implementation and corrupted several files' in-progress edits. Use a separate worktree, or just don't touch git state, if you need a "clean" comparison point.
- Don't hardcode k6 test credentials or default a k6 script's `BASE_URL` to anything but `localhost`, and don't let a script run against a non-localhost target without the explicit `K6_ALLOW_NON_LOCAL` opt-in — see `k6/lib/config.js`. In CI, that opt-in is only ever set as an explicit workflow env var (`.github/workflows/k6-performance.yml`), never a script default.

## Roadmap (future intent, not started)

- **Infrastructure as Code.** Every GCP resource behind the API's CI/CD (Artifact Registry repo, IAM bindings, the `guitarcoach-api-runtime` service account, Secret Manager secrets, the Cloud SQL connection, the Cloud Run service itself — see `docs/deployment.md`) was provisioned by hand via one-off `gcloud` commands, not tracked in code. The user wants to eventually manage this as Terraform (the `google` provider maps directly onto everything already provisioned) so the whole stack can be declaratively provisioned or torn down. This is a stated future intent only — nothing has been started, and no Terraform files exist. Don't scaffold this unprompted; wait to be asked, since it involves deciding whether Terraform should also own stateful resources like the Cloud SQL instance/data (risky to model if `destroy` is ever run).
- **Nightly heavier k6 load/stress/soak tests.** `.github/workflows/k6-performance.yml` (see `docs/performance-testing.md`) only runs the lightweight smoke + short low-concurrency load test on every PR/merge. A separate `on: schedule:` (cron) workflow running heavier load/stress/soak profiles against the same staging target, nightly, is a stated future intent only — no schedule, workflow file, or new script variants exist for it yet. Don't scaffold this unprompted; wait to be asked.

## Key file pointers

- `prisma/schema.prisma` — full data model (models, enums, relations); `prisma/seed.ts` — idempotent dev seed data.
- `src/config/env.validation.ts` — the Zod schema that is the single source of truth for every environment variable; update this first when adding a new env var, then `.env.example`.
- `src/prisma/prisma.service.ts` — the shared `PrismaService`/`PrismaModule` (`@Global()`); reuse this rather than instantiating `PrismaClient` elsewhere.
- `src/auth/auth.ts` — Better Auth instance construction (plugins, rate limiting, email hooks); `src/auth/redis-rate-limit-storage.ts` — the Redis-backed rate-limit storage implementation.
- `src/redis/redis-lock.service.ts` — the distributed lock used by `routines`; reuse it for any new feature needing mutual exclusion instead of adding a second lock implementation.
- `src/gcp-storage/gcp-storage.service.ts` — the sole `@google-cloud/storage` wrapper (`@Global()`); reuse it rather than constructing a second `Storage` client. Note the temp-file-then-`bucket.upload()` upload path — don't revert to `file.save(buffer)` (see the comment in that file for why).
- `src/routines/events/` — the RabbitMQ producer/consumer pattern (`*.producer.ts`/`*.consumer.ts`, shared queue-options constants) to copy for any new async domain event.
- `src/weekly-routine-cleanup/` — the standalone scheduled-batch-job pattern (own `main.ts`/`env.validation.ts`) to copy for any new scheduled job; see Architecture notes.
- `src/ai-practice-planner/` — the reference pattern for a confirmation-gated AI/LLM tool-calling integration: the `AiProvider` interface + DI-token seam (`openai/`), the "the model's write tool is only ever included in the request *after* explicit user confirmation" persistence-safety pattern, and `CreateRoutineTool` (`tools/`) reusing `RoutinesService`/`TasksService` instead of touching Prisma directly.
- `src/ai-routine-coach/` — the reference pattern for a `@openai/agents` tool-calling integration with no confirmation step: a single `Agent` (`agent/routine-coach-agent.factory.ts`), five typed tools each as a testable handler + `tool()` factory (`tools/`), the `requireUserId()`/`RunContext` seam that keeps `userId` out of every tool's model-facing schema, the `AGENT_RUNNER` DI-token seam for testing without mocking the SDK, and the native heuristic `InputGuardrail` (`agent/routine-coach.guardrail.ts`) as the "one real guardrail" reference — copy this pattern rather than adding a second LLM-classifier `Agent` for a new guardrail.
- `test/support/build-test-app.ts` — the e2e `TestingModule` builder and its infra-boundary overrides (`FakeGcpStorageService`, `FakeRoutineEventsClient`, `FakeAuthGuard`); see Testing conventions.
- `src/observability/` — the reference pattern for cross-cutting logging/correlation/security-events/metrics: `request-context.ts` (`AsyncLocalStorage`), `structured-logger.service.ts` (installed via `app.useLogger(...)`), `correlation-id.middleware.ts`, `http-exception.filter.ts` (response normalization, downstream of per-service Prisma translation — see Forbidden shortcuts), `security-event.logger.ts`, and `metrics/meters.ts`/`metrics/metrics.module.ts` (OTel instruments + the GCP Cloud Monitoring OTLP exporter, fail-open, gated by `METRICS_EXPORT_ENABLED`). `@Global()`, registered once in `app.module.ts` — don't reconstruct any piece of this in a feature module.
- `k8s/` — the reusable Kustomize `base/` + `overlays/local/` pattern for running the app on Kubernetes: `base/` holds only portable application workloads (`api` Deployment/Service, the `weekly-routine-cleanup` CronJob, a ConfigMap of cross-environment defaults) and references a Secret by name without defining it; `overlays/local/` holds everything kind-specific (Postgres/Redis/RabbitMQ Deployments+Services+PVCs, the Namespace, `imagePullPolicy: Never` patches, and a `secretGenerator` sourced from a gitignored `secrets.local.env`). A future staging/GKE overlay should reuse `base/` unmodified and only add its own overlay directory — see `k8s/README.md` for the full workflow and the "What changes for GKE later" section.
- `docs/monitoring/` — the alerting runbook: `README.md` (setup + alert catalog), `alert-policies/*.json` and `log-based-metrics/*.json` (`gcloud`-applyable templates). No Terraform — matches the Roadmap note below.
- `k6/` — the reference pattern for k6 performance tests: `lib/config.js` (env-var-driven tuning/thresholds plus the localhost-only safety guard), `lib/auth.js` (sign-in-then-sign-up-fallback session provisioning done once in `setup()`, never per-VU/iteration — the auth endpoints are rate-limited), `lib/workflows.js` (tagged, checked HTTP calls shared between the smoke and load scripts, plus `cleanupPracticeSessions` called once from each script's `teardown()` against `PracticeSessionsController.deleteByTitle` so a run never leaves rows behind). `.github/workflows/k6-performance.yml` runs the same scripts in CI against the app's existing deployed (pre-production/"staging") environment, as an independent, parallel workflow — see Architecture notes. Copy this shape for a new module's perf tests rather than re-deriving auth/config/threshold wiring from scratch; see `docs/performance-testing.md`.
- `.env.example` — annotated list of every environment variable; `compose.yaml` (base) + `compose.dev.yaml`/`compose.prod.yaml` (overlays) — Docker Compose service wiring.
- `README.md` — architecture diagram, ER diagram, local setup, and a short teaser + link per feature; read this first for "how does X work end-to-end," then follow its `## Documentation` index into `docs/*.md` for the full endpoint curl examples, provisioning scripts, and architecture-decision rationale before re-deriving any of it from code.

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

