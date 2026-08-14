# Performance testing

k6 smoke and load tests for the `practice-sessions` module's create/list/get workflows — the first performance-testing coverage in the repo, scoped to that one module only. See [README.md](../README.md) for the rest of the API, and [Authentication](authentication.md) for how the underlying sign-in/sign-up flow works.

Every script authenticates as a dedicated test user via the real Better Auth flow, never a developer's personal account or the shared seed users (`alice@guitarcoach.dev` etc. from `prisma/seed.ts`) — `setup()` tries signing in with the configured test-user credentials and falls back to signing up if that account doesn't exist yet, so the same script works unchanged on a fresh environment and on every subsequent run.

## Prerequisites

- The [k6 binary](https://grafana.com/docs/k6/latest/set-up/install-k6/) installed locally — it's a standalone Go binary, not an npm package, so it isn't a `package.json` dependency.
- A running target: locally, the Docker Compose dev stack (`docker compose -f compose.yaml -f compose.dev.yaml up`) with the API healthy at `GET http://localhost:3000/health/ready`.

## Running locally

```bash
# Required — no defaults, must be set explicitly (credentials are never
# hardcoded in the scripts themselves)
export K6_TEST_USER_EMAIL="k6-perf-test@example.com"
export K6_TEST_USER_PASSWORD="Str0ngPassw0rd!123"

# Optional — defaults to http://localhost:3000, and the scripts refuse any
# other host unless K6_ALLOW_NON_LOCAL=true is also set (see Safety below)
export BASE_URL="http://localhost:3000"

# Smoke test: one VU, one iteration through create -> get -> list
npm run perf:smoke

# Load test: defaults to 5 VUs for 30s; override via env vars
K6_LOAD_VUS=10 K6_LOAD_DURATION=60s npm run perf:load
```

## What each script does

Both scripts (`k6/practice-sessions-smoke.js`, `k6/practice-sessions-load.js`) run the same three tagged requests per iteration, shared from `k6/lib/workflows.js`:

- `create` — `POST /api/v1/practice-sessions` with a minimal `{ title }` body (no `routineId`/`tasks`, to keep this test self-contained and independent of the Routines/Tasks modules). `title` is always the same fixed literal (`k6 practice session`) so cleanup (below) can find everything a run created.
- `get` — `GET /api/v1/practice-sessions/:id` for the session just created.
- `list` — `GET /api/v1/practice-sessions`.

Once, at the very end of a run — not per-iteration — `teardown()` calls `DELETE /api/v1/practice-sessions?title=k6%20practice%20session` to remove everything that run created (see "Test data / cleanup" below). This runs once regardless of VU count and even if thresholds failed, so a run never leaves residue behind, while the `list` workload above still gets to exercise a genuinely growing history *during* the run — cleanup only happens after.

Each request is tagged (`{ name: 'create' | 'list' | 'get' }`) so their latency/error metrics are reported separately, not blended into one overall number. Each also has a `check()` asserting both the HTTP status *and* a minimally-shaped response body (e.g. `create` checks for a string `id`, `get` checks the returned `id` matches) — a `200`/`201` with a malformed or empty body fails the run, not just a non-2xx status.

The smoke test runs the workflow once (`shared-iterations`, 1 VU, 1 iteration) with hard-coded, non-configurable functional-correctness bars (`checks` must be 100%, each per-workflow `http_req_failed{name:...}` must be 0%) — a smoke test's job is "does the happy path work at all," which isn't something you tune. Its per-workflow latency thresholds (`http_req_duration{name:...}`), however, come from the same configurable `K6_THRESHOLD_P95_MS`/`K6_THRESHOLD_P99_MS` env vars as the load test (see Thresholds below) — CI overrides both. The load test runs it continuously across `K6_LOAD_VUS` VUs for `K6_LOAD_DURATION` (`constant-vus` executor, no `sleep()`/think-time — this is a closed-loop "how fast can N VUs round-trip this" test, not a modeled arrival-rate test).

## Interpreting the output

k6's end-of-test summary reports, for every metric+tag combination referenced in `thresholds`:

- `http_req_duration{name:create}` / `{name:list}` / `{name:get}` — per-workflow latency, alongside the blended overall `http_req_duration` (shown, but not threshold-gated — see below). `summaryTrendStats` is set to show `min`, `avg`, `med` (**this is p50**), `p(90)`, `p(95)`, `p(99)`, `max`.
- `http_req_failed{name:create}` / `{name:list}` / `{name:get}` — per-workflow error rate. Thresholds are deliberately scoped to these three tags, not the blended/untagged `http_req_failed` — `setup()`'s sign-in probe is *expected* to fail once with a non-2xx on a brand-new test user before its sign-up fallback succeeds, and that one handled auth outcome shouldn't count against the practice-sessions error-rate bar. `http_reqs` (total requests and requests/sec) is still printed unconditionally as the throughput signal.
- `checks` — the separate *functional correctness* signal. A `200 OK` with a malformed or wrong-shaped body fails a `check()`, not `http_req_failed` — both are gated by a threshold specifically so a "successful-looking" broken response can't silently pass.

Each threshold line in the summary shows `✓`/`✗`. k6 exits non-zero if any threshold is breached — no extra scripting is needed to "fail the build" on a regression.

## Thresholds

| Env var | Default (local) | Meaning |
|---|---|---|
| `K6_THRESHOLD_ERROR_RATE` | `0.01` (1%) | Max allowed `http_req_failed` rate |
| `K6_THRESHOLD_P95_MS` | `500` | Max allowed p95 latency (overall and per-workflow) |
| `K6_THRESHOLD_P99_MS` | `1000` | Max allowed p99 latency (overall and per-workflow) |

**These are arbitrary, adjustable starting points chosen for a first pass — not measured or verified production SLAs.** Run the load test a few times locally (or against staging, see below) and adjust these based on what you actually observe, rather than treating the defaults as a target to hit.

## Safety: local by default

`BASE_URL` defaults to `http://localhost:3000`. Any other host is refused with an explicit error unless `K6_ALLOW_NON_LOCAL=true` is also set — this is enforced in `k6/lib/config.js` before any request is sent. Recognized "local" hosts: `localhost`, `127.0.0.1`, `[::1]` (with or without a port). A custom `/etc/hosts` alias or something like `host.docker.internal` also requires the explicit opt-in — deliberately simple rather than clever.

## Test data / cleanup

Each run's `teardown()` automatically deletes every session it created, via `DELETE /api/v1/practice-sessions?title=k6%20practice%20session` (see [Practice recordings](practice-recordings.md) for the full endpoint description) — a bulk, exact-title-match delete scoped to the caller's own account, the one bulk/filtered delete in this API (every other delete is single-resource-by-id). Cleanup is best-effort: a failure there only logs a warning, it never flips an otherwise-successful smoke/load run to failed, since cleanup isn't part of what's being measured.

This is still not a substitute for running against a database you're comfortable with — only ever point `BASE_URL` at a disposable environment (the local Docker Compose Postgres, or a pre-production staging environment — see below), never a real production database, in case a run is interrupted before its `teardown()` fires (e.g. a killed process).

**Cleaning up data created before this endpoint existed**: the same endpoint works from a plain `curl` too — sign in as whichever test account accumulated rows (locally, or the CI test user against staging) and run the same `DELETE` call manually once. No separate script is needed.

## Continuous integration

`.github/workflows/k6-performance.yml` runs the same smoke test plus a short, low-concurrency load run on every pull request and every merge to `main`, targeting the app's existing deployed Cloud Run environment (`guitarcoach`) — the only environment that currently exists, used here in its pre-production role since this application isn't serving real production traffic yet. It's a third, independent workflow file (no `needs:` on `ci.yml`'s `build-and-test` job), so it runs in parallel with the existing format/lint/test/build checks rather than lengthening that pipeline.

- **Target**: the `staging` GitHub Environment's `STAGING_BASE_URL` variable, with `K6_ALLOW_NON_LOCAL=true` set explicitly in the workflow (never as a script default) — the same safety guard used locally, satisfied by never pointing `BASE_URL` at localhost in CI.
- **Credentials**: a dedicated CI-only test account, fetched from GCP Secret Manager (`guitarcoach-k6-perf-test-email`/`guitarcoach-k6-perf-test-password`) via the same Direct Workload Identity Federation already used by the deploy workflow — never a developer's personal account, never a literal in the workflow file.
- **Load profile**: intentionally small — 3 VUs for 90 seconds — to keep the whole job inside a 5-minute budget.
- **CI-specific relaxed latency thresholds** (set as explicit workflow env vars on *both* the smoke and load steps, not the local defaults above): `K6_THRESHOLD_P95_MS=800`, `K6_THRESHOLD_P99_MS=1500` (load additionally sets `K6_THRESHOLD_ERROR_RATE=0.01`, though the smoke script's own hard-coded `http_req_failed{name:...} == 0` bar already subsumes it there). These sit with headroom inside the existing production alerting SLOs in [`docs/monitoring/README.md`](monitoring/README.md) (p95 > 2s, >5% 5xx trigger an alert), so a CI failure is a tighter, earlier signal than an actual alert — not a copy of it, and still just a starting point to revisit once real staging numbers exist. The smoke step needs this relaxation too, not just load: its single `create` request is the first workload request of the whole job (right after `setup()`'s sign-in/sign-up), with no warm-up to absorb a Cloud Run cold start, so the unmodified 500/1000ms local defaults were prone to false-positive failures on a cold instance.
- A threshold breach fails the k6 step (k6 itself exits non-zero), which fails the job — no extra step is needed to turn a threshold violation into a failed pipeline.

**One-time GCP/GitHub setup** this depends on (not automated — see [Continuous deployment](deployment.md) for the equivalent one-time setup pattern this follows): two new Secret Manager secrets for the CI test user, a `secretmanager.secretAccessor` grant scoped to those secrets for the existing CI Workload Identity principal, and a `staging` GitHub Environment holding `STAGING_BASE_URL`. See `deployment.md`'s "k6 performance-test CI job" subsection for the exact commands.

**Planned, not yet implemented**: a nightly/scheduled workflow running heavier load/stress/soak profiles against the same staging target. This is recorded as a future intent in `CLAUDE.md`'s Roadmap — no schedule, workflow file, or new script variants exist for it yet.

## Out of scope

This module's tests deliberately do not cover: AI features (`ai-practice-planner`, `ai-routine-coach`), the `routines` module's own endpoints, RabbitMQ/worker behavior, Redis-specific behavior, or spike/stress/soak load profiles (see "Planned, not yet implemented" above). No CI job runs these as part of every PR pipeline.

## Env var reference

All of the following are read directly by the k6 scripts via `__ENV` — they are **not** application environment variables, are never read by the NestJS app process, and are not part of `src/config/env.validation.ts`/`.env.example`.

| Env var | Default | Required? | Meaning |
|---|---|---|---|
| `BASE_URL` | `http://localhost:3000` | No | Target host. Non-local values need `K6_ALLOW_NON_LOCAL=true`. |
| `K6_ALLOW_NON_LOCAL` | (unset) | No | Set to `true` to allow a non-localhost `BASE_URL`. |
| `K6_TEST_USER_EMAIL` | — | **Yes** | Dedicated test user's email — never hardcoded. |
| `K6_TEST_USER_PASSWORD` | — | **Yes** | Dedicated test user's password — never hardcoded. |
| `K6_TEST_USER_NAME` | `k6 Perf Test User` | No | Display name used only if the test user needs to be signed up. |
| `K6_LOAD_VUS` | `5` | No | Load test virtual users (`practice-sessions-load.js` only). |
| `K6_LOAD_DURATION` | `30s` | No | Load test duration (`practice-sessions-load.js` only). |
| `K6_THRESHOLD_ERROR_RATE` | `0.01` | No | Max allowed error rate (both scripts). |
| `K6_THRESHOLD_P95_MS` | `500` | No | Max allowed p95 latency in ms (both scripts). |
| `K6_THRESHOLD_P99_MS` | `1000` | No | Max allowed p99 latency in ms (both scripts). |
