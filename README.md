# Guitar Coach API

Backend API for Guitar Coach, built with [NestJS](https://nestjs.com/).

## Overview

Guitar Coach is a backend API for tracking guitar practice: users build practice **routines** from a shared library of **tasks** (technique/theory/repertoire exercises), log **practice sessions**, and attach audio **recordings** of those sessions for later review.

The project is a standard NestJS application (Express platform) organized by feature module:

- **`config`** — loads and validates environment variables at startup using [Zod](https://zod.dev/) (`src/config/env.validation.ts`), exposed globally via `AppConfigModule`.
- **`health`** — Kubernetes/Docker-style liveness and readiness probes via [`@nestjs/terminus`](https://docs.nestjs.com/recipes/terminus).
- **`auth`** — email/password authentication via [Better Auth](https://www.better-auth.com/), mounted through [`@thallesp/nestjs-better-auth`](https://github.com/ThallesP/nestjs-better-auth) (see [Authentication](#authentication)).
- **`users`** — CRUD user management backed by Postgres via Prisma (see [Architecture decisions](#architecture-decisions)).
- **`tasks`** — CRUD task-library management backed by Postgres via Prisma, with pagination and filtering by `category`/`difficulty`, Redis-cached reads (see [Data model](#data-model)).
- **`routines`** — user-owned, ordered lists of tasks with per-task target durations; supports reordering under a Redis distributed lock, and publishes a `routine.created` event to RabbitMQ (see [Routines](#routines)).
- **`practice-sessions`** — user practice logs with attached audio recordings uploaded to Google Cloud Storage (see [Practice recordings](#practice-recordings)).
- **`gcp-storage`** — thin wrapper around [`@google-cloud/storage`](https://github.com/googleapis/nodejs-storage) used by `practice-sessions` to upload/delete objects and mint signed download URLs (see [Architecture](#architecture)).
- **`prisma`** — `PrismaService`/`PrismaModule` wiring Prisma ORM to Postgres (see [Architecture decisions](#architecture-decisions)).

Cross-cutting infra (not feature modules, but wired globally in `AppModule`): a Redis-backed HTTP response cache, a Redis distributed lock, Redis-backed Better Auth rate-limit storage, and a self-consumed RabbitMQ queue for domain events (see [Architecture](#architecture)).

**Tech stack**: NestJS 11 (Express), TypeScript, Prisma 7 with the `@prisma/adapter-pg` driver adapter, Postgres 17, Better Auth 1.6, Redis 8, RabbitMQ 4, Google Cloud Storage, Zod (config validation), class-validator/class-transformer (request DTOs), Jest (unit + e2e).

API docs are served by Swagger UI at `/docs` once the app is running (covers the Nest-controller routes below; Better Auth's own `/auth/*` endpoints aren't introspectable by Swagger — see [Authentication](#authentication)).

## Architecture

The API runs as a single **hybrid** Nest application: it serves HTTP over Express and, in the same process, runs a RabbitMQ microservice consumer — there's no separate worker deployable.

```mermaid
flowchart LR
    client[Client]

    subgraph api["Guitar Coach API (Nest hybrid app)"]
        http["HTTP controllers"]
        consumer["RoutineCreatedConsumer"]
    end

    client -->|"REST + session cookie"| http
    http --> postgres[("Postgres 17")]
    http -->|"cache / lock / rate-limit"| redis[("Redis 8")]
    http -->|"emit routine.created"| rabbitmq{{"RabbitMQ 4"}}
    rabbitmq -->|"consume routine.created"| consumer
    http -->|"upload / signed URL"| gcs[("Google Cloud Storage")]
```

- **Postgres** is the system of record for everything (via Prisma). Every other piece of infra below is a supporting concern the app can degrade gracefully without.
- **Redis** backs three independent concerns, each with its own key namespace: an HTTP response cache for `GET /tasks*` (`TasksService`, via `@nestjs/cache-manager` + Keyv), a distributed lock guarding routine task-reordering (`RedisLockService`, `SET NX PX` + Lua compare-and-delete release), and rate-limit counters for Better Auth's `/sign-in/email`/`/sign-up/email` (`RedisRateLimitStorage`, wired as Better Auth's `customStorage` rather than `secondaryStorage` so session/verification data never lands in Redis). All three **fail open** — a Redis outage degrades to "no cache"/"no rate limit" rather than an outage, except the distributed lock, which fails closed (`503`) since reordering without it could corrupt task ordering.
- **RabbitMQ** carries a single domain event today: `RoutineCreatedProducer` publishes `routine.created` (fire-and-forget — a broker outage must never fail routine creation) after `POST /routines`, consumed in-process by `RoutineCreatedConsumer`, currently just a logging placeholder for future side effects (notifications, analytics, etc.).
- **Google Cloud Storage** stores practice recording bytes privately; only metadata (object name, content type, size) lives in Postgres. `GcpStorageService.uploadObject` writes incoming buffers to a short-lived temp file and uses `bucket.upload()` rather than `file.save(buffer)` — the latter reliably triggered a `"Cannot call write after a stream was destroyed"` race in the client library's internal write pipeline when the whole buffer was pushed before the async upload-request setup had settled; `bucket.upload()` feeds the same pipeline via a paced `fs.createReadStream`, avoiding the race.

A fourth, fully separate process — the weekly routine cleanup job — runs outside this hybrid app entirely, on its own schedule; see [Weekly routine cleanup job](#weekly-routine-cleanup-job).

## User flow

1. **Sign up / sign in** — email + password via Better Auth, session cookie issued (see [Authentication](#authentication)).
2. **Browse the task library** — `GET /tasks`, optionally filtered by `category`/`difficulty` (see [Data model](#data-model)).
3. **Build a routine** — create a routine and attach tasks to it in order, with optional per-task target durations; reorder as needed (see [Routines](#routines)).
4. **Log a practice session** — create a practice session, optionally against a routine you followed (see [Practice recordings](#practice-recordings)).
5. **Upload a recording** — attach an audio recording of that session to Google Cloud Storage.
6. **Review later** — list a session's recordings and fetch a time-limited signed download URL for playback.

## Data model

Defined in `prisma/schema.prisma`; regenerate the diagram below by hand if the schema changes.

```mermaid
erDiagram
    USER ||--o{ ROUTINE : "routines"
    USER ||--o{ PRACTICE_SESSION : "practiceSessions"
    USER ||--o{ RECORDING : "recordings"
    USER ||--o{ SESSION : "sessions"
    USER ||--o{ ACCOUNT : "accounts"
    ROUTINE ||--o{ ROUTINE_TASK : "routineTasks"
    TASK ||--o{ ROUTINE_TASK : "routineTasks"
    PRACTICE_SESSION ||--o{ RECORDING : "recordings"

    USER {
        uuid id PK
        varchar displayName
        varchar email UK
        boolean emailVerified
        varchar role
        boolean banned
        timestamp createdAt
        timestamp updatedAt
    }

    TASK {
        uuid id PK
        varchar title
        TaskCategory category
        TaskDifficulty difficulty
        text referenceLink
        text description
        timestamp createdAt
        timestamp updatedAt
    }

    ROUTINE {
        uuid id PK
        uuid userId FK
        varchar title
        RoutineStatus status
        text notes
        timestamp createdAt
        timestamp updatedAt
    }

    ROUTINE_TASK {
        uuid routineId PK, FK
        uuid taskId PK, FK
        int position
        int targetDurationMinutes
        timestamp createdAt
        timestamp updatedAt
    }

    PRACTICE_SESSION {
        uuid id PK
        uuid userId FK
        varchar title
        text notes
        timestamp createdAt
        timestamp updatedAt
    }

    RECORDING {
        uuid id PK
        uuid userId FK
        uuid practiceSessionId FK
        text objectName
        text originalFileName
        varchar contentType
        int sizeBytes
        timestamp createdAt
    }

    SESSION {
        uuid id PK
        uuid userId FK
        varchar token UK
        timestamp expiresAt
        varchar ipAddress
        varchar userAgent
    }

    ACCOUNT {
        uuid id PK
        uuid userId FK
        varchar providerId
        varchar accountId
        varchar password
    }
```

`category`, `difficulty`, and `status` are Postgres enums, not free-form strings:

- `TaskCategory`: `technique` | `theory` | `repertoire`
- `TaskDifficulty`: `easy` | `medium` | `hard`
- `RoutineStatus`: `active` | `archived` (default `active`)

`RoutineTask` is a join table between `Routine` and `Task` with a composite primary key (`routineId`, `taskId`) and a unique `(routineId, position)` constraint enforcing one task per position within a routine.

`Recording` carries **two** foreign keys back to different ancestors — `userId` (direct owner) and `practiceSessionId` (parent session) — a denormalized owner reference that keeps ownership checks a single-column lookup instead of a join through `PracticeSession`.

Domain foreign keys (`Routine`, `RoutineTask`, `PracticeSession`, `Recording` → `User`) default to Postgres's `ON DELETE RESTRICT`: a user can't be deleted while they still own routines, sessions, or recordings. Better Auth's own tables behave differently — `Session` and `Account` cascade-delete when their `User` is deleted. `Session`, `Account`, and `Verification` are Better Auth's own tables (session tokens, linked credentials/OAuth accounts, and email-verification/reset tokens respectively); `Verification` has no FK to `User`, it's looked up by `identifier` instead.

## Local setup

### Prerequisites

- Node.js 24.x and npm
- Docker (for Postgres/Redis/RabbitMQ, and optionally for running the API itself)

### Option A — Docker Compose (recommended)

Runs the API, Postgres, Redis, and RabbitMQ together, with hot reload via bind mounts.

```bash
cp .env.example .env   # fill in POSTGRES_PASSWORD at minimum
docker compose -f compose.yaml -f compose.dev.yaml up
```

The API is available at `http://localhost:3000` (or `$PORT`), reloading on changes under `src/` and `test/`. Postgres is published on `$POSTGRES_PORT` (default `5432`).

**After changing `prisma/schema.prisma`**, rebuild the `api` image before testing against it:

```bash
docker compose -f compose.yaml -f compose.dev.yaml build api
docker compose -f compose.yaml -f compose.dev.yaml up -d api
```

The container's startup command only runs `prisma migrate deploy` (applies migration SQL) — it never runs `prisma generate`, so a running container's Prisma Client is stuck with whatever shape the schema had at image build time. `src`/`test` file sync doesn't cover this either. Symptoms if you skip this: `PrismaClientValidationError: Unknown argument '<field>'` in `docker compose logs api`, or a DB value you just changed (e.g. a user's `role`) not seeming to take effect.

For a production-shaped image instead:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up --build
```

### Option B — Node directly

```bash
npm install
cp .env.example .env   # PORT/API_PREFIX/API_VERSION have defaults; NODE_ENV and DATABASE_URL are required
npx prisma generate     # generates the Prisma Client into src/generated/prisma
npm run start:dev
```

Note: `PrismaService` connects lazily, so the app boots without a reachable Postgres — but the `users` module queries the database on every request, so you'll need one running (and migrated) before calling any `/users` endpoint. Start one with `docker compose -f compose.yaml -f compose.dev.yaml up postgres`, then apply migrations with `npx prisma migrate deploy` (or point `DATABASE_URL` at any already-migrated Postgres 17-compatible instance).

### Environment variables

Validated in `src/config/env.validation.ts`; the app fails fast on startup if required variables are missing or malformed.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | — | `development` \| `test` \| `production` |
| `PORT` | no | `3000` | |
| `API_PREFIX` | no | `api` | Global route prefix |
| `API_VERSION` | no | `v1` | |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Compose only | — | Configure the `postgres` container in `compose.yaml` |
| `DATABASE_URL` | yes | — | Postgres connection string read by Prisma (CLI and `PrismaService`). `compose.yaml` overrides it to point at the `postgres` service; `.env.example` has a `localhost` default for running the API outside Docker |
| `BETTER_AUTH_SECRET` | yes | — | Encryption/signing secret for Better Auth, min 32 characters. Generate with `openssl rand -base64 32`; never reuse the placeholder in `.env.example` |
| `BETTER_AUTH_URL` | yes | — | Base URL the API is served from (e.g. `http://localhost:3000`). Better Auth appends its own `/auth` base path |
| `REDIS_URL` | yes | — | Redis connection string, shared by the HTTP cache, the routine-reorder distributed lock, and Better Auth rate limiting. `compose.yaml` overrides it to point at the `redis` service |
| `CACHE_TTL_MS` | no | `300000` | TTL for cached `GET /tasks`/`GET /tasks/:id` responses, 60000–600000 |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | Compose only | — | Configure the `rabbitmq` container in `compose.yaml`; the default `guest`/`guest` account only authenticates from localhost inside the container, so a real user/password is required |
| `RABBITMQ_URL` | yes | — | AMQP connection string for the `routine.created` event producer/consumer. `compose.yaml` overrides it to point at the `rabbitmq` service |
| `GCP_PROJECT_ID` / `GCS_RECORDINGS_BUCKET` | yes | — | GCP project and private bucket practice recordings are uploaded to |
| `GOOGLE_APPLICATION_CREDENTIALS` | local dev only | — | Path to a local service-account key file, read directly by `@google-cloud/storage` via Application Default Credentials (not through `ConfigService`). Must be fully-qualified — `~/...` is **not** expanded. Unset in production; Cloud Run's attached service account is used instead |
| `GCP_CREDENTIALS_HOST_PATH` | Docker Compose only | — | Same absolute host path as above; `compose.dev.yaml` bind-mounts it read-only into the container and points `GOOGLE_APPLICATION_CREDENTIALS` at the in-container path for you |
| `RECORDING_UPLOAD_MAX_SIZE_BYTES` | no | `52428800` (50MB) | Max accepted size for a single practice recording upload |
| `RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS` | no | `900` | How long a `GET .../download-url` signed URL stays valid |

See `.env.example` for the full annotated list.

The [weekly routine cleanup job](#weekly-routine-cleanup-job) is a separate standalone process validated by its own, smaller schema (`src/weekly-routine-cleanup/env.validation.ts`): it reuses `DATABASE_URL` above and adds `ROUTINE_CLEANUP_TIME_ZONE` (default `UTC`) and `CLEANUP_WEEK_START` (manual override only) — it does not require any of the other variables in this table.

Redis and RabbitMQ are **required** by `compose.yaml` (`RABBITMQ_USER`/`RABBITMQ_PASSWORD` fail the Compose config outright if unset) — Option A always needs them reachable. Running via Option B (Node directly), the app itself tolerates them being unreachable at boot: the cache, distributed lock, and rate-limit storage all fail open/closed gracefully (see [Architecture](#architecture)) rather than crashing startup, though routine reordering will return `503` without a working Redis, and `routine.created` events silently won't publish without a working RabbitMQ.

### Common commands

```bash
npm run start:dev      # watch mode
npm run build           # compile to dist/
npm run start:prod      # run compiled output

npm run lint             # eslint --fix
npm run test             # unit tests (*.spec.ts, alongside source in src/)
npm run test:e2e         # e2e tests (test/*.e2e-spec.ts)
npm run test:cov         # coverage

npx prisma generate      # regenerate Prisma Client into src/generated/prisma after a schema change
npx prisma migrate dev   # create/apply a migration against DATABASE_URL
npx prisma studio        # browse the database

npm run weekly-routine-cleanup         # run the weekly routine cleanup job locally via tsx (see below)
npm run start:weekly-routine-cleanup   # run the compiled dist/ build (requires `npm run build` first) — mirrors the deployed Cloud Run Job's entrypoint
```

A Husky `pre-commit` hook checks `package-lock.json` stays in sync whenever `package.json` is staged.

## Authentication

Auth is handled by [Better Auth](https://www.better-auth.com/) (email/password only for now), mounted at the bare `/auth` path — **not** under the `${API_PREFIX}/${API_VERSION}` prefix used by every other route, and not documented in the `/docs` Swagger UI (Better Auth's endpoints are raw Express middleware, not Nest controllers, so Swagger can't introspect them).

A global `AuthGuard` protects every other route by default — requests without a valid session cookie get `401 Unauthorized`. Individual routes opt out with the `@AllowAnonymous()`/`@OptionalAuth()` decorators from `@thallesp/nestjs-better-auth`.

```bash
# Sign up (creates the User row + a session cookie)
curl -i -c cookies.txt -X POST http://localhost:3000/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"jordan@example.com","password":"correct-horse-battery","name":"Jordan"}'

# Sign in (existing user)
curl -i -c cookies.txt -X POST http://localhost:3000/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"jordan@example.com","password":"correct-horse-battery"}'

# Inspect the current session
curl -i -b cookies.txt http://localhost:3000/auth/get-session

# Sign out (revokes the session)
curl -i -b cookies.txt -X POST http://localhost:3000/auth/sign-out

# Call a protected route with the session cookie
curl -i -b cookies.txt http://localhost:3000/api/v1/users/me
```

`sendVerificationEmail`/`sendResetPassword` (`src/auth/email.ts`) currently just `console.log` the link instead of sending a real email — check the server output for the verification link after signing up.

### Roles & admin access

Two roles: `user` (default for every new sign-up) and `admin`, enforced via the `@Roles(['admin'])` decorator from `@thallesp/nestjs-better-auth` on `UsersController`'s and `TasksController`'s mutating/listing routes. Backed by Better Auth's `admin` plugin (`src/auth/auth.ts`).

`role` is a server-only field — it is **not** accepted in the `/auth/sign-up/email` body (or any other client-facing endpoint). Every new user gets `role: "user"` regardless of what you send.

**Bootstrapping the first admin**: Better Auth's admin endpoints (`/auth/admin/set-role`, `/auth/admin/create-user`) always require an authenticated admin session when called over real HTTP — there's no way to promote the very first user through the API. Set it directly in the database once:

```bash
npx prisma studio   # opens http://localhost:5555
```

Open the `User` table and change that row's `role` to `admin`. (If you're on Docker Compose, remember the container's Prisma Client needs rebuilding after any schema change — see [Option A above](#option-a--docker-compose) — though editing existing data via Prisma Studio doesn't require that.)

**Promoting/demoting a user once an admin exists** — reuse the cookie-jar pattern from above:

```bash
# Sign in as the admin
curl -i -c cookies.txt -X POST http://localhost:3000/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"correct-horse-battery"}'

# Promote another user to admin (or back to "user")
curl -i -b cookies.txt -X POST http://localhost:3000/auth/admin/set-role \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<target-user-uuid>","role":"admin"}'
```

## Routines

A routine is a user-owned, ordered list of tasks pulled from the shared [task library](#data-model), each with an optional target duration. All routes below require a session cookie — see [Authentication](#authentication) to sign in and obtain `cookies.txt` first. Routines and their tasks are scoped to the requesting user: acting on another user's routine returns `404 Not Found` (not `403`).

```bash
# Create a routine
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/routines \
  -H 'Content-Type: application/json' \
  -d '{"title":"Daily warm-up","notes":"15 minutes before practice"}'

# Attach a task to it (position/targetDurationMinutes are optional; position defaults to "next")
curl -i -b cookies.txt -X POST \
  http://localhost:3000/api/v1/routines/<routine-uuid>/tasks \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"<task-uuid>","targetDurationMinutes":10}'

# List a routine's tasks, in order
curl -i -b cookies.txt http://localhost:3000/api/v1/routines/<routine-uuid>/tasks

# Reorder tasks (must include every taskId currently in the routine, in the new order)
curl -i -b cookies.txt -X PATCH \
  http://localhost:3000/api/v1/routines/<routine-uuid>/tasks/reorder \
  -H 'Content-Type: application/json' \
  -d '{"taskIds":["<task-uuid-2>","<task-uuid-1>"]}'

# Remove a task from the routine
curl -i -b cookies.txt -X DELETE \
  http://localhost:3000/api/v1/routines/<routine-uuid>/tasks/<task-uuid>

# Delete the routine (409 if it still has tasks attached)
curl -i -b cookies.txt -X DELETE http://localhost:3000/api/v1/routines/<routine-uuid>
```

Reordering acquires a short-lived Redis distributed lock per routine (see [Architecture](#architecture)): a concurrent reorder request on the same routine fails fast with `409 Conflict` instead of queuing, and `503 Service Unavailable` if the lock can't be acquired at all. Creating a routine also publishes a `routine.created` event to RabbitMQ — this is fire-and-forget and never blocks or fails the request itself.

## Practice recordings

Authenticated users can upload audio recordings of their practice sessions. Files are stored privately in Google Cloud Storage; only metadata (file name, content type, size, object path) is kept in Postgres. Requires `GCP_PROJECT_ID` and `GCS_RECORDINGS_BUCKET` to be set (see [Environment variables](#environment-variables)).

**Credentials, local dev only** (production/Cloud Run uses the attached service account instead): `GOOGLE_APPLICATION_CREDENTIALS` must be a fully-qualified path — Node reads it literally, so `~/...` shortcuts are **not** expanded and fail with `ENOENT`. If running via Docker Compose ([Option A](#option-a--docker-compose)), the container also can't see that host path directly — set `GCP_CREDENTIALS_HOST_PATH` in `.env` to the same absolute host path; `compose.dev.yaml` bind-mounts it read-only into the container and points `GOOGLE_APPLICATION_CREDENTIALS` at the in-container path for you. See `.env.example` for both.

Allowed content types: `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/mp4`, `audio/x-m4a`, `audio/ogg`, `audio/webm`. Max upload size defaults to 50MB, configurable via `RECORDING_UPLOAD_MAX_SIZE_BYTES`.

All routes below require a session cookie — see [Authentication](#authentication) to sign in and obtain `cookies.txt` first.

```bash
# Create a practice session to attach recordings to
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/practice-sessions \
  -H 'Content-Type: application/json' \
  -d '{"title":"Evening practice","notes":"Worked on barre chords"}'

# Upload a recording to that session (multipart/form-data, field name "file")
curl -i -b cookies.txt -X POST \
  http://localhost:3000/api/v1/practice-sessions/<session-uuid>/recordings \
  -F 'file=@practice.mp3;type=audio/mpeg'

# List recordings for a session
curl -i -b cookies.txt http://localhost:3000/api/v1/practice-sessions/<session-uuid>/recordings

# Get a time-limited signed download URL for a recording
curl -i -b cookies.txt http://localhost:3000/api/v1/recordings/<recording-uuid>/download-url

# Delete a recording (removes both the GCS object and its metadata row)
curl -i -b cookies.txt -X DELETE http://localhost:3000/api/v1/recordings/<recording-uuid>
```

The download URL returned by `/recordings/:id/download-url` expires after `RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS` (default 900s / 15 minutes) — request a fresh one if it lapses.

Sessions and recordings are scoped to the requesting user: acting on another user's session or recording returns `404 Not Found` (not `403`), so existence isn't leaked to non-owners.

## Weekly routine cleanup job

A standalone, HTTP-less NestJS process (`src/weekly-routine-cleanup/`) that archives routines left `active` from before the current week, so every user starts the week with a clean routine list. It runs separately from the API — as a scheduled Google Cloud Run Job, not the in-process hybrid pattern used for the RabbitMQ consumer.

**Selection rule:** a routine is archived only if `status = active AND createdAt < currentWeekStart`. Routines created during the current week, and routines already `archived`, are left untouched. (This schema currently has no `completed` status — only `active`/`archived` — so there's nothing else to leave unchanged.)

**Week boundary:** "current week" starts Monday 00:00:00 in `ROUTINE_CLEANUP_TIME_ZONE` (default `UTC` — this repo has no other established app timezone). The boundary is computed with `Intl.DateTimeFormat`/`Date` only (no date library dependency), and is DST-correct: it resolves the target Monday's own UTC offset, not "now"'s. `CLEANUP_WEEK_START` (ISO 8601) overrides this for local testing or a one-off manual rerun with a specific boundary — it must never be set on the scheduled job itself.

**Idempotency:** archiving only ever matches `status: active`, so once a routine flips to `archived` it's excluded from every later run — rerunning the job any number of times is safe.

```bash
# Local run against your dev DATABASE_URL
npm run weekly-routine-cleanup

# --- One-time GCP project setup ---

# Enable the APIs this job's deploy/schedule steps depend on
gcloud services enable run.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  --project=PROJECT_ID

# Create the Artifact Registry repo images are pushed to (shared with the API
# image below — same repo, same `api` image name, this job just overrides the
# container command at deploy time).
gcloud artifacts repositories create guitar-coach \
  --repository-format=docker --location=REGION --project=PROJECT_ID

# Let Docker push to Artifact Registry
gcloud auth configure-docker REGION-docker.pkg.dev

# Create the job's runtime service account (referenced by --service-account
# below). No project-level IAM roles needed yet — it only needs read access
# to the DATABASE_URL secret, granted next.
gcloud iam service-accounts create weekly-routine-cleanup-job \
  --project=PROJECT_ID \
  --display-name="Weekly routine cleanup Cloud Run Job"

# Store the production DATABASE_URL as a secret and grant the job's service
# account access to it. Must exist before `gcloud run jobs create` below,
# which references it via --set-secrets.
printf '%s' "postgresql://USER:PASSWORD@HOST:5432/DB" | \
  gcloud secrets create weekly-routine-cleanup-database-url \
  --project=PROJECT_ID --data-file=-
gcloud secrets add-iam-policy-binding weekly-routine-cleanup-database-url \
  --project=PROJECT_ID \
  --member="serviceAccount:weekly-routine-cleanup-job@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
# Network reachability from Cloud Run to wherever Postgres is hosted (Cloud
# SQL private/public IP via a VPC connector or the Cloud SQL Auth Proxy, vs.
# an externally hosted Postgres reachable over the public internet with SSL)
# is a separate concern this repo doesn't prescribe — configure whatever the
# chosen DATABASE_URL target actually requires.

# Deploy as a Cloud Run Job using the SAME image/tag you already build and
# push for the API — the job only overrides the container command below, so
# there's no separate image to build. `--target production` is required (not
# `development`): that stage is the only one that runs `npm run build`, so
# it's the only one containing dist/ at all — view pushed tags at
# console.cloud.google.com/artifacts or
# `gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/guitar-coach`.
# --platform linux/amd64 is required when building on Apple Silicon (or any
# non-amd64 host) — Cloud Run only runs linux/amd64 images, and Docker
# otherwise defaults to the host's own architecture, which fails at deploy
# time with "Container manifest ... must support amd64/linux".
docker build --platform linux/amd64 --target production -t REGION-docker.pkg.dev/PROJECT_ID/guitar-coach/api:TAG .
docker push REGION-docker.pkg.dev/PROJECT_ID/guitar-coach/api:TAG

gcloud run jobs create weekly-routine-cleanup \
  --image=REGION-docker.pkg.dev/PROJECT_ID/guitar-coach/api:TAG \
  --region=REGION \
  --service-account=weekly-routine-cleanup-job@PROJECT_ID.iam.gserviceaccount.com \
  --command=node --args=dist/src/weekly-routine-cleanup/main.js \
  --set-secrets=DATABASE_URL=weekly-routine-cleanup-database-url:latest \
  --set-env-vars=ROUTINE_CLEANUP_TIME_ZONE=UTC \
  --max-retries=0 --task-timeout=5m --cpu=1 --memory=512Mi

# Run on demand, any time (safe — the job is idempotent)
gcloud run jobs execute weekly-routine-cleanup --region=REGION

# Create the identity Cloud Scheduler uses to invoke this job, and grant it
# permission to invoke — scoped to this specific job, not project-wide.
# Must happen after the job above exists.
gcloud iam service-accounts create routine-cleanup-scheduler-invoker \
  --project=PROJECT_ID \
  --display-name="Cloud Scheduler invoker for weekly-routine-cleanup"
gcloud run jobs add-iam-policy-binding weekly-routine-cleanup \
  --region=REGION \
  --member="serviceAccount:routine-cleanup-scheduler-invoker@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Schedule it for every Monday at 00:05 (must match ROUTINE_CLEANUP_TIME_ZONE's
# time zone, or the job fires at the wrong local wall-clock time)
gcloud scheduler jobs create http weekly-routine-cleanup-trigger \
  --location=REGION --schedule="5 0 * * 1" --time-zone="UTC" \
  --uri="https://REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT_ID/jobs/weekly-routine-cleanup:run" \
  --http-method=POST \
  --oauth-service-account-email=routine-cleanup-scheduler-invoker@PROJECT_ID.iam.gserviceaccount.com

# Inspect executions and logs
gcloud run jobs executions list --job=weekly-routine-cleanup --region=REGION
gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=weekly-routine-cleanup' --limit=50
```

## Continuous deployment

`.github/workflows/google-cloudrun-docker.yml` builds the API image, pushes it to Artifact Registry, and deploys it to Cloud Run on every push to `main`. `.github/workflows/ci.yml` runs format/lint/test/build on every PR. Both authenticate to Google Cloud via **Direct Workload Identity Federation** — no service account key ever exists as a GitHub secret; a GitHub Actions OIDC token is exchanged directly for short-lived GCP credentials, scoped to a specific repo.

```bash
# --- One-time GCP project setup ---

# Enable the APIs this workflow depends on
gcloud services enable run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  iamcredentials.googleapis.com \
  --project=PROJECT_ID

# Create the Workload Identity Pool + GitHub OIDC provider. attribute-condition
# restricts the whole pool to one GitHub org; individual role grants below
# narrow further to one specific repo via attribute.repository.
gcloud iam workload-identity-pools create github \
  --project=PROJECT_ID --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc REPO_NAME \
  --project=PROJECT_ID --location=global --workload-identity-pool=github \
  --display-name="GitHub repo Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'YOUR_GITHUB_ORG'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Every grant below targets this same principal: any workflow run from this
# one repo (a principalSet, not a service account — Direct WIF has no service
# account of its own on the CI side).
WIF_MEMBER="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/YOUR_GITHUB_ORG/REPO_NAME"

# Artifact Registry repo images are pushed to. Docker/Artifact Registry image
# references need FOUR path segments (HOST/PROJECT/REPOSITORY/IMAGE) — the
# workflow's REPOSITORY and SERVICE env vars fill the last two, and can be the
# same value if there's no need to distinguish them.
gcloud artifacts repositories create REPO_NAME \
  --repository-format=docker --location=REGION --project=PROJECT_ID
gcloud artifacts repositories add-iam-policy-binding REPO_NAME \
  --project=PROJECT_ID --location=REGION \
  --member="$WIF_MEMBER" --role="roles/artifactregistry.writer"

# Deploy access. roles/run.developer covers creating/updating revisions but
# NOT setting IAM policy on the service (no setIamPolicy permission) — the
# workflow's --allow-unauthenticated flag silently no-ops without the
# additional service-scoped roles/run.admin grant further down.
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="$WIF_MEMBER" --role="roles/run.developer"

# Dedicated least-privilege runtime SA for the deployed service — deliberately
# not the default compute SA, which typically carries a broad legacy
# roles/editor grant. Scoped to exactly what the app needs at runtime: Cloud
# SQL client, object access to its own bucket, and its own secrets.
gcloud iam service-accounts create SERVICE_NAME-api-runtime \
  --project=PROJECT_ID --display-name="SERVICE_NAME API Cloud Run runtime"
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:SERVICE_NAME-api-runtime@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
gcloud storage buckets add-iam-policy-binding gs://YOUR_BUCKET_NAME \
  --member="serviceAccount:SERVICE_NAME-api-runtime@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
gcloud iam service-accounts add-iam-policy-binding \
  SERVICE_NAME-api-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --project=PROJECT_ID --member="$WIF_MEMBER" --role="roles/iam.serviceAccountUser"

# Production secrets. DATABASE_URL connects to Cloud SQL over the Unix socket
# Cloud Run's built-in connector mounts at /cloudsql/CONNECTION_NAME (wired up
# via --add-cloudsql-instances on the deploy step below) — not a public
# host:port.
printf '%s' "postgresql://USER:PASSWORD@localhost/DB?host=/cloudsql/PROJECT_ID:REGION:INSTANCE&schema=public" | \
  gcloud secrets create SERVICE_NAME-database-url --project=PROJECT_ID --data-file=-
openssl rand -base64 32 | gcloud secrets create SERVICE_NAME-better-auth-secret --project=PROJECT_ID --data-file=-
printf '%s' "rediss://default:PASSWORD@YOUR_REDIS_HOST:6379" | \
  gcloud secrets create SERVICE_NAME-redis-url --project=PROJECT_ID --data-file=-
printf '%s' "amqps://USER:PASSWORD@YOUR_RABBITMQ_HOST/VHOST" | \
  gcloud secrets create SERVICE_NAME-rabbitmq-url --project=PROJECT_ID --data-file=-
for SECRET in SERVICE_NAME-database-url SERVICE_NAME-better-auth-secret SERVICE_NAME-redis-url SERVICE_NAME-rabbitmq-url; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project=PROJECT_ID \
    --member="serviceAccount:SERVICE_NAME-api-runtime@PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# Allow public invocation. The app's own global AuthGuard (Better Auth) is the
# real per-route authorization boundary — this only lets requests reach the
# container at all; without it, ONLY other GCP principals (never an end user's
# browser/mobile client, which can't mint a Google identity token) could ever
# reach the service. Requires the service-scoped run.admin grant above, since
# run.developer alone can't set IAM policy.
gcloud run services add-iam-policy-binding SERVICE_NAME \
  --region=REGION --project=PROJECT_ID \
  --member="$WIF_MEMBER" --role="roles/run.admin"
```

**Gotchas hit getting this working, in case they recur:**

- **Artifact Registry image paths need four segments**, `HOST/PROJECT/REPOSITORY/IMAGE` — a workflow that only sets `PROJECT/SERVICE` (three segments) fails at push time with `invalid tag ...: Missing image name`, not at deploy time, so it's easy to mistake for an IAM problem.
- **The Prisma Client for a custom `output` path isn't generated automatically.** Nothing in `npm ci`/`postinstall` runs `prisma generate` for a non-default output path (`src/generated/prisma` here); a Dockerfile that goes straight from `COPY . .` to `RUN npm run build` only "works" locally because that gitignored directory already exists on disk from a prior manual `prisma generate` — a clean CI checkout has no such directory, and `tsc` fails with `TS2307` across every file that imports from it.
- **`WORKLOAD_IDENTITY_PROVIDER` must be the full provider resource path**, ending in `/providers/PROVIDER_ID` — not `/subject/...` or any other suffix. `google-github-actions/auth` sends this value straight through as the OIDC `audience`; a malformed path fails at GCP's STS endpoint with an "Invalid value for audience" error that gives no hint which part is wrong.
- **`google-github-actions/auth` can't infer `project_id`** under Direct WIF (no `service_account`/`credentials_json` input to extract it from) — pass it explicitly, or every later `gcloud`-based step (e.g. `deploy-cloudrun`) fails with "The [project] resource is not properly specified."
- **A stray `$` immediately before a `${{ }}` expression** (e.g. `` `$${{ env.REGION }}` ``) is invisible in a diff but corrupts the tag at runtime: GitHub Actions' expression matcher consumes `${{ ... }}` starting from the *second* `$`, leaving a literal `$` behind for the shell to (mis)interpret as the start of a different variable.
- **RabbitMQ connectivity is a hard boot-blocker, Redis is not.** `main.ts` calls `app.startAllMicroservices()` (which connects to RabbitMQ) *before* `app.listen()`, with no connect timeout — an unreachable broker hangs the container until Cloud Run's startup probe kills it, surfacing as a generic "failed to start and listen on the port" error that looks identical to an env-validation crash. `RedisLockService.onModuleInit()` deliberately races its connect against a 2s timeout, so Redis being unreachable only logs a warning (see [Architecture decisions](#architecture-decisions)).
- **`roles/run.developer` doesn't include `run.services.setIamPolicy`.** A workflow step passing `--allow-unauthenticated` will deploy successfully (creating the revision *is* covered) but silently fail to apply the public-invoker binding, with no visible error in the Action's log — the fix is a separate, service-scoped `roles/run.admin` grant (as above), not a broader project-level role.

## Architecture decisions

- **Config validation with Zod, not `class-validator`.** Environment variables are parsed once at boot through a Zod schema (`env.validation.ts`) rather than Nest's usual `class-validator`-based config approach, so invalid/missing env vars crash startup immediately with a clear message instead of surfacing as runtime errors deep in a request.
- **Global API prefix + versioning, health checks excluded.** `main.ts` sets a global prefix of `${API_PREFIX}/${API_VERSION}` (e.g. `/api/v1`) but explicitly excludes `health/live` and `health/ready` so container orchestrators can probe unversioned, well-known paths.
- **Liveness vs. readiness split.** `health/live` reports process-up-ness only (no checks). `health/ready` additionally checks heap/RSS memory and disk usage via Terminus, matching the Docker/Compose `HEALTHCHECK` which polls `/health/ready`.
- **`users` module backed by Prisma.** The `users` module (controller/service/DTOs) is a complete vertical slice against Postgres, with `UsersService` injecting `PrismaService` directly — matching NestJS's own [Prisma recipe](https://docs.nestjs.com/recipes/prisma), which doesn't interpose a separate repository class. `UsersService` owns business rules and translates Prisma errors (`P2002` unique violation, `P2025` not found) into `ConflictException`/`NotFoundException`. Uniqueness is enforced by the database's unique index on `email` and caught after the write, rather than checked beforehand, to avoid a check-then-act race between concurrent requests.
- **Prisma ORM wired to Postgres.** `PrismaModule`/`PrismaService` (`src/prisma/`) wire Prisma Client into Nest as a global provider, using the `@prisma/adapter-pg` driver adapter over `pg` per Prisma 7's required driver-adapter workflow. `PrismaService` doesn't eagerly connect in `onModuleInit` — Prisma Client connects lazily on first query, so the app can boot without a reachable Postgres until a module actually queries the database. The generated client is emitted to `src/generated/prisma` (gitignored, regenerate with `prisma generate`) with `moduleFormat = "cjs"`, since this project is CommonJS and the default ESM output breaks under `ts-jest`. See [Data model](#data-model) for the full schema.
- **Multi-stage Dockerfile, dev vs. prod targets.** The Dockerfile separates a `development` target (full `node_modules`, `start:dev`, source bind-mounted via Compose `watch`) from a `production` target (prod-only dependencies, compiled `dist/` only, runs as the non-root `node` user). `compose.dev.yaml` / `compose.prod.yaml` are overlays selecting the target rather than separate Dockerfiles, keeping build logic in one place.
- **Global validation pipe with `whitelist` + `forbidNonWhitelisted`.** Incoming request bodies are stripped of unknown properties and reject requests containing them, so DTOs (e.g. `CreateUserDto`) are the sole contract for what the API accepts.
- **Swagger mounted unauthenticated at `/docs`.** Unaffected by the global `AuthGuard` (Swagger, like Better Auth's own routes, is mounted directly on the underlying HTTP adapter rather than as a Nest controller). Acceptable for now since it only exposes route/DTO shapes, not data; revisit (gate behind auth, or disable in production) once that's no longer true.
- **Auth endpoints documented in the README, not Swagger.** `@nestjs/swagger` only introspects Nest controllers; Better Auth's endpoints are raw Express middleware, so they don't appear in the generated OpenAPI document. See [Authentication](#authentication) for example requests instead.
- **Redis caching fails open, not closed.** `TasksService`'s cache reads/writes (`safeCacheGet`/`safeCacheSet`/`safeCacheDel`) catch and log any Redis error rather than propagating it — Postgres stays authoritative, so a Redis outage degrades `GET /tasks*` to uncached rather than erroring. List-cache invalidation uses a version-bump key (`tasks:list:version`) rather than pattern-delete, since the generic `Cache` interface can't enumerate/delete by pattern.
- **Distributed lock for routine reordering, not a DB transaction alone.** `RoutinesService.reorderTasks` acquires a per-routine Redis lock (`RedisLockService`, TTL 5s, Lua compare-and-delete release) before reordering, because a naive transaction alone wouldn't stop a second concurrent request from reading the same pre-reorder state. Reposition itself runs in **two phases** inside a single Prisma `$transaction` — first to negative placeholder positions, then to final positions — since the `@@unique([routineId, position])` constraint is checked per-statement (not deferred), so writing final positions directly would collide with whatever task currently holds that slot.
- **Better Auth rate limiting uses Redis as `customStorage`, not `secondaryStorage`.** `secondaryStorage` is also consulted for session/verification-token caching, which would put PII into Redis; `customStorage` scopes Redis strictly to rate-limit counters for `/sign-in/email` and `/sign-up/email`.
- **RabbitMQ event publishing is fire-and-forget.** `RoutineCreatedProducer.publish` is called after a routine is created and wrapped in try/catch purely to guard against a synchronous throw — a broker outage must never fail routine creation. The consumer (`RoutineCreatedConsumer`) runs in the same process via Nest's hybrid-microservice bootstrap (`app.connectMicroservice`/`startAllMicroservices` in `main.ts`), not a separate worker deployable.
- **GCS uploads go through a temp file, not `file.save(buffer)`.** `GcpStorageService.uploadObject` writes the incoming buffer to disk and calls `bucket.upload()` instead — `file.save(buffer)`'s single `.end(buffer)` call reliably raced against `@google-cloud/storage`'s internal async upload-connection setup (`"Cannot call write after a stream was destroyed"`); `bucket.upload()` feeds the same pipeline via a backpressure-paced `fs.createReadStream`, avoiding it.
- **Weekly routine cleanup is a standalone `createApplicationContext`, not a fourth hybrid-microservice consumer.** Unlike the RabbitMQ consumer (in-process alongside HTTP), this job boots its own minimal Nest module (`ConfigModule` + `PrismaModule` only) with no HTTP listener, deployed as a separate Cloud Run Job/Cloud Scheduler pair. It intentionally does not depend on `RoutinesModule` (which requires `RABBITMQ_URL`/`REDIS_URL` for its producer/lock deps this job has no use for) or the main `env.validation.ts` schema (which requires unrelated secrets like `BETTER_AUTH_SECRET`) — keeping its own env/IAM footprint to just `DATABASE_URL` and two job-specific vars.
- **Weekly routine cleanup has no retry logic, by design.** `run()` does a single atomic `prisma.routine.updateMany` that's idempotent (once a routine flips to `archived` it no longer matches `status: active`), and the selection window (`createdAt < currentWeekStart`) is cumulative rather than "this week only" — so a failed or skipped run is always caught by the next scheduled run or an on-demand `gcloud run jobs execute`. The Cloud Run Job is deployed with `--max-retries=0` deliberately: since the job self-heals on the next run anyway, blind auto-retry would mostly just retry non-transient failures (bad `DATABASE_URL`, IAM misconfiguration) instead of surfacing them immediately in logs.

## Resources

- [NestJS Documentation](https://docs.nestjs.com)
- [Terminus health checks](https://docs.nestjs.com/recipes/terminus)
- [Zod](https://zod.dev/)
- [Better Auth](https://www.better-auth.com/docs)
- [Prisma](https://www.prisma.io/docs)
- [Redis](https://redis.io/docs/latest/)
- [RabbitMQ](https://www.rabbitmq.com/docs) / [amqplib](https://github.com/amqp-node/amqplib)
- [@google-cloud/storage](https://github.com/googleapis/nodejs-storage)
