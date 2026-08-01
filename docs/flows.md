# Application flows

This document walks through every request path in the app end-to-end: what happens at each step, which technology is involved, and what happens when a dependency (Redis, RabbitMQ, MongoDB, Postgres) is unavailable. It complements the [README](../README.md), which covers setup and a summary of the activity feed; this file goes deeper and covers every flow, not just that one.

Both apps share one Postgres database (via Prisma, `apps/guitar-coach` only) and one Redis instance (rate limiting, caching, distributed locking — all in `apps/guitar-coach`). Only `apps/activity-feed-service` talks to MongoDB. RabbitMQ is the sole connection between the two apps.

## 1. Request lifecycle basics

Every HTTP request into `apps/guitar-coach` passes through, in order:

1. **Global prefix** — `main.ts` mounts all Nest controllers under `${API_PREFIX}/${API_VERSION}` (e.g. `/api/v1`), except `health/live` and `health/ready`, which stay unversioned so container orchestrators can probe a fixed path.
2. **`ValidationPipe`** (global) — `whitelist: true`, `forbidNonWhitelisted: true`. Any request body property not declared on the target DTO causes a `400 Bad Request`; DTOs are the sole contract for what the API accepts.
3. **`AuthGuard`** (global, registered via `APP_GUARD` by `@thallesp/nestjs-better-auth`) — resolves the Better Auth session from the request cookie and attaches it to the request. Every route is authenticated by default. Routes that must skip this use `@AllowAnonymous()` (currently only the two health routes).
4. **`@Roles([...])`** — an additional check layered on top of the auth guard for admin-only routes; compares `session.user.role` against the decorator's list.

Better Auth's own routes (`/auth/*` — sign-up, sign-in, sign-out, admin management) are mounted as raw middleware on the underlying HTTP adapter, not as Nest controllers, so they don't appear in the generated Swagger document at `/docs` and aren't subject to the `ValidationPipe` above (Better Auth validates its own request bodies internally).

## 2. Auth — sign-up (`POST /auth/sign-up/email`)

1. Better Auth (`apps/guitar-coach/src/auth/auth.ts`) validates the request body (email format, password length) via its own internal validation.
2. **Rate limiting**: Better Auth calls `RedisRateLimitStorage.consume(key, { window: 60, max: 3 })` (`auth/redis-rate-limit-storage.ts`), keyed per route (`/sign-up/email`). `consume` runs a single Lua script over Redis (`@redis/client`, `eval`):
   ```lua
   local count = redis.call("INCR", KEYS[1])
   if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
   local ttl = redis.call("TTL", KEYS[1])
   return {count, ttl}
   ```
   INCR+EXPIRE run as one atomic step so concurrent requests can't both observe count `1` and each re-arm the TTL, which would let a burst through indefinitely. If `count <= max` the request is allowed; otherwise it's rejected with `retryAfter` set from the TTL.
   - **If Redis is down**: `consume()` catches the error, logs `this.logger.warn('Rate limit check failed for key "...", error)`, and returns `{ allowed: true, retryAfter: null }` — **fails open**. Sign-up/sign-in are never blocked by a Redis outage.
3. Better Auth hashes the password (scrypt, built-in — no custom hasher configured).
4. **Postgres writes** via Prisma (`prismaAdapter`, `apps/guitar-coach/src/prisma/`): a `User` row (with `role: "user"`, `banned: false` defaults from the `admin()` plugin — see §4), an `Account` row (credential provider + hashed password), and a `Verification` row (email-verification token, since `emailVerification.sendOnSignUp: true`).
5. `sendVerificationEmail` (`auth/email.ts`) is called with the verification URL — it currently just logs it to the console; no real email provider is wired up.
6. A session cookie is issued in the response (Better Auth auto-signs-in on sign-up by default).

## 3. Auth — sign-in (`POST /auth/sign-in/email`)

Same guard/routing path and rate-limiting mechanism as sign-up, with a stricter-looking-but-actually-looser rule: `{ window: 60, max: 5 }` vs. sign-up's `max: 3`. On success:

1. Better Auth looks up the `User`/`Account` rows via Prisma and verifies the password hash.
2. A `Session` row is created in Postgres (`token`, `expiresAt`, `userId`) and a signed session cookie is returned.
3. There is no `secondaryStorage` configured, so subsequent requests resolve the session by querying Postgres directly through Prisma — Redis is never on the session read path, only the rate-limit path.

## 4. Authenticated request + role checks

- Controllers read the current user via the `@Session() session: UserSession` param decorator (from `@thallesp/nestjs-better-auth`), then use `session.user.id` to scope Prisma queries — e.g. every method in `routines.controller.ts` passes `session.user.id` into `RoutinesService`, and `users.controller.ts`'s `GET /users/me` returns `session.user` directly.
- The Better Auth `admin()` plugin (`auth.ts`) adds `role`/`banned`/`banReason`/`banExpires`/`impersonatedBy` fields to the `User` model and exposes ban/unban/set-role/impersonate routes under `/auth/admin/*` (provided by Better Auth itself, no custom code here). Application code only consumes the `role` field via `@Roles(['admin'])`, gating: all mutating `UsersController` routes, and `TasksController`'s create/update/remove.
- `TasksController`'s read routes and `RoutinesController` (all routes) require only a valid session, no specific role — routines are scoped by ownership (`userId`) instead of a role check.
- `HealthController`'s two routes are the only ones marked `@AllowAnonymous()`.

## 5. Users CRUD (`/users`)

All CRUD goes through `UsersService`, never `PrismaService` directly from the controller.

- `GET /users/me` — returns `session.user`, no database call.
- `GET /users` (admin-only) → `prisma.user.findMany()`.
- `GET /users/:id` (admin-only) → `prisma.user.findUnique()`; throws `404 NotFoundException` if absent.
- `PATCH /users/:id` (admin-only) — body validated (`@IsEmail`, `@IsString @Length(2,100)`), email normalized (trim + lowercase) before `prisma.user.update()`. Prisma `P2025` (record not found) → `404`; `P2002` (unique constraint, duplicate email) → `409 Conflict`. The uniqueness check happens by catching the database's own unique-index violation after the write, not with a pre-check, to avoid a check-then-act race between two concurrent updates to the same email.
- `DELETE /users/:id` (admin-only, `204`) → `prisma.user.delete()`; `P2025` → `404`.

## 6. Tasks CRUD + cache (`/tasks`)

- `POST` / `PATCH` / `DELETE` are `@Roles(['admin'])`-gated; `GET` (list and by-id) require only a session.
- `TasksService` is a read-through cache in front of Postgres, using Nest's `CacheModule` backed by `@keyv/redis` (`KeyvRedis`, registered in `app.module.ts`). Postgres is always the source of truth; the cache is purely an optimization.
- **List caching** (`GET /tasks`): the cache key embeds a version number — `` tasks:list:v${version}:${page}:${limit}:${category}:${difficulty} `` — read from a shared counter key, `TASK_LIST_VERSION_KEY = 'tasks:list:version'`. On a cache miss, `Promise.all([prisma.task.findMany(...), prisma.task.count(...)])` runs and the result is cached.
- **Versioned invalidation**: any create/update/delete calls `bumpListCacheVersion()`, which increments and rewrites `TASK_LIST_VERSION_KEY` (TTL `0`, i.e. never expires). Because the generic cache interface has no pattern-delete, old-version list entries (`v0:...`, `v1:...`, ...) are **not** deleted — they're simply orphaned, since every future list read now computes a key under the new version and misses. The orphaned entries expire naturally once their own TTL (`CACHE_TTL_MS`) elapses.
- **By-id caching** (`GET /tasks/:id`): simple key `` tasks:${id} ``, invalidated (`safeCacheDel`) directly on update/delete.
- **Fail-open on cache errors**: `safeCacheGet`/`safeCacheSet`/`safeCacheDel` each wrap the underlying cache call in try/catch, log a warning, and return `undefined`/no-op on failure — a Redis outage degrades to always-miss (every request falls through to Postgres) rather than failing the request. The `KeyvRedis` client is configured with `disableOfflineQueue: true` and a 2s connect timeout so these calls fail fast instead of hanging.
- Deleting a task that's still referenced by a routine (`P2003`, foreign-key constraint) → `409 Conflict` instead of a raw database error.

## 7. Routines CRUD (`/routines`)

- All routes require a session; every query is scoped to `session.user.id` using `findFirst` / `updateMany` / `deleteMany` (never `findUnique`, since routine IDs alone don't prove ownership) — a `0`-count result maps to `404 NotFoundException` rather than leaking whether the ID exists for another user.
- Nested task management (`POST/GET/PATCH/DELETE /routines/:routineId/tasks[/:taskId]`) manipulates the `RoutineTask` join table; `P2002` (duplicate task already on the routine) → `409`, `P2003` (task or routine doesn't exist) → `404`.
- Deleting a routine that still has tasks assigned (`P2003`) → `409 Conflict`.

## 8. Routine creation → RabbitMQ emit

1. `POST /routines` → `RoutinesService.create()` writes the `Routine` row via Prisma **first**.
2. Only after that write succeeds does it call `RoutineCreatedProducer.publish(routine)`, wrapped in a try/catch that just logs a warning on synchronous failure — publish failure never affects the HTTP response.
3. The producer (`routines/events/routine-created.producer.ts`) builds a `RoutineCreatedEvent` (`eventId: randomUUID()`, `eventType: 'routine.created'`, `eventVersion: 1`, `occurredAt`, `data: { routineId, userId, title, status }`) and calls `this.client.emit('routine.created', event)` on the injected `ClientProxy` (token `ACTIVITY_FEED_CLIENT`, an RMQ transport registered in `activity-feed.module.ts`, queue `activity_feed_queue`, durable).
4. `.emit()` returns a hot observable; the code explicitly `.subscribe({ error: ... })` so a broker-unreachable error is logged rather than becoming an unhandled RxJS error.
5. **If RabbitMQ is unreachable**: the event is logged and dropped. There is no retry, outbox, or dead-letter fallback — this is an explicit fire-and-forget design. The routine still exists in Postgres and the HTTP request still returns `201`; it simply never appears in the activity feed.

## 9. Reorder tasks → distributed Redis lock

`PATCH /routines/:routineId/tasks/reorder` is the flow most worth calling out, because two concurrent reorders for the same routine could otherwise both pass validation against the pre-reorder state and interleave their writes, corrupting the `position` ordering.

1. `RoutinesService.reorderTasks()` computes a per-routine lock key: `` lock:routine:${routineId}:reorder ``.
2. It calls `RedisLockService.acquire(lockKey, REORDER_LOCK_TTL_MS)` (`REORDER_LOCK_TTL_MS = 5000`ms). `acquire` issues `SET key token NX PX 5000` (token = `randomUUID()`) — this succeeds only if no other request currently holds the lock.
   - **If another request already holds the lock**: `acquire` returns `null` → the service throws `409 ConflictException` ("Another reorder is already in progress for this routine"). The client is expected to retry.
   - **If Redis itself is unreachable** (the `SET` call throws): the service catches it, logs a warning, and throws `503 ServiceUnavailableException` — this is a deliberate **fail-closed** design, the opposite of the cache/rate-limiter above. A reorder is a multi-step read-then-write operation where an unenforced lock could silently corrupt ordering, so the service rejects the request rather than proceeding without the safety net.
3. On successful acquisition, it validates that the submitted `taskIds` is exactly the existing set of task IDs for that routine (no additions/removals via this endpoint) — a mismatch is a `400 BadRequestException`.
4. It then runs a two-phase `prisma.$transaction`: first move every task to a negative placeholder position (`-(index+1)`), then move them all to their final positions (`index+1`). This two-phase approach is necessary because Postgres enforces the `unique(routineId, position)` constraint per-statement (not deferred) — writing final positions directly would collide with whatever task currently occupies that slot.
5. **In a `finally` block**, the lock is always released via `RedisLockService.release(lockKey, token)`, which runs a Lua script doing a conditional `GET`+`DEL`:
   ```lua
   if redis.call("GET", KEYS[1]) == ARGV[1] then
     return redis.call("DEL", KEYS[1])
   end
   return 0
   ```
   This CAS (compare-and-swap) check matters because if the original lock already expired (past its 5s TTL) and was re-acquired by a *different* request, a naive unconditional `DEL` would delete that new holder's lock out from under them. Release errors are caught and logged, not thrown — a release failure doesn't fail the response (the lock will simply expire on its own via the TTL).

## 10. Activity-feed consumer (RabbitMQ → MongoDB)

Runs entirely inside `apps/activity-feed-service`, a pure microservice (`NestFactory.createMicroservice()`, no HTTP server, no `app.connectMicroservice()`), listening on the same `activity_feed_queue`.

1. `@EventPattern('routine.created')` receives the event payload. There's no schema/runtime validation of the payload — it's trusted as coming from the internal broker boundary (main API is the only producer on this queue).
2. `ActivityFeedService.recordRoutineCreated()` writes an `ActivityFeedEntry` document to MongoDB (`@nestjs/mongoose`): `eventId` (unique index), `eventType`, `userId` (indexed), `occurredAt`, and a nested `data` object (`routineId`, `title`, `status`).
3. **Idempotency**: RabbitMQ can redeliver a message (e.g. after a consumer crash before ack). A redelivered `routine.created` hits the same unique index on `eventId`, Mongo returns a duplicate-key error (`code 11000`), which is caught, logged as a warning, and swallowed — the handler returns normally.
4. **Any other write failure** (e.g. MongoDB unreachable) is *not* caught the same way — it propagates out of the handler. There's no explicit manual ack/nack configured, so the message is effectively dropped rather than requeued: no dead-letter queue, no retry policy configured for this consumer today.

## 11. Activity-feed query (`GET /api/v1/activity-feed`)

1. The main API's controller derives `userId` **only** from `@Session() session: UserSession` — it accepts no `userId` query parameter, so a client cannot read another user's feed by passing one.
2. It calls `this.client.send('activity-feed.get-by-user', { userId })` on the `ACTIVITY_FEED_CLIENT` `ClientProxy` and awaits the reply via `firstValueFrom(...)`.
3. On the consumer side, `@MessagePattern('activity-feed.get-by-user')` runs `.find({ userId }).sort({ occurredAt: -1 }).limit(50).lean()` against MongoDB — a fixed cap of the 50 most recent entries, no pagination.
4. **If the consumer is down or the RPC times out**: there is no `.pipe(timeout(...))` or fallback configured around `client.send()`. The underlying observable errors, `firstValueFrom` rejects, and Nest's default exception filter turns that into a `500 Internal Server Error` — there's no graceful degradation (e.g. returning an empty feed) today.

## 12. Health checks (`/health/live`, `/health/ready`)

Built on `@nestjs/terminus`, both routes are `@AllowAnonymous()` and excluded from the global API-version prefix so orchestrators can probe fixed paths.

- `GET /health/live` — liveness only: an empty check list, i.e. "the process is up and responding." Doesn't touch Postgres, Redis, RabbitMQ, or Mongo.
- `GET /health/ready` — readiness: checks heap/RSS memory and disk usage via Terminus indicators (300MB thresholds, 90% disk threshold on `/`).
- **Known gap**: neither check currently verifies connectivity to Postgres, Redis, RabbitMQ, or MongoDB — a container could report "ready" while any of those dependencies is actually unreachable. Worth knowing rather than assuming health checks catch a downstream outage.

## 13. Failure-mode summary

| Dependency | Used by | On failure | Behavior |
|---|---|---|---|
| Redis (rate limiting) | Sign-up / sign-in | Connection error on `eval` | **Fails open** — request proceeds unthrottled, warning logged |
| Redis (task cache) | `GET /tasks`, `GET /tasks/:id` | Connection error on get/set/del | **Fails open** — falls through to Postgres, no caching until Redis recovers |
| Redis (reorder lock) | `PATCH /routines/:id/tasks/reorder` | Connection error on `SET`/lock script | **Fails closed** — `503 ServiceUnavailableException`; request rejected rather than risking a corrupted reorder |
| RabbitMQ (producer) | `POST /routines` → `routine.created` emit | Broker unreachable | **Fails open for the HTTP request** — `201` still returned; event is logged and silently dropped, no retry/outbox |
| RabbitMQ (consumer, event) | `routine.created` → Mongo write | Mongo write throws (non-duplicate) | Error propagates, message effectively dropped (no manual ack/nack, no DLQ). Duplicate-key errors (redelivery) are caught and swallowed intentionally. |
| RabbitMQ (consumer, RPC) | `GET /activity-feed` → `activity-feed.get-by-user` | Consumer down / RPC timeout | **Fails closed** — no timeout/fallback configured, surfaces as `500` to the client |
| Postgres | Everything except activity-feed | Connection error | Not caught anywhere in application code — surfaces as an unhandled `500`. Prisma Client connects lazily (no eager `onModuleInit` connect), so the app can boot even if Postgres isn't reachable yet. |
| MongoDB | activity-feed-service only | Connection error | Same as Postgres — no bespoke handling beyond what's described in §10 for write-time duplicate-key errors. |
