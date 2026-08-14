# Request flows

Four representative request/data flows through the API, traced step by step against the actual code. [`README.md`](../README.md) covers the "what" (endpoints, data model, setup); this covers the "how" for the four mechanisms that recur across every feature module — useful when extending one of these patterns (a new cached resource, a new async event, a new user-scoped write) rather than inventing a new one.

- [Authentication](#authentication)
- [Core write](#core-write)
- [Cached read](#cached-read)
- [Asynchronous domain event](#asynchronous-domain-event)

## Authentication

Auth is [Better Auth](https://www.better-auth.com/) (email/password), mounted as raw Express middleware at the bare `/auth` path — outside the `${API_PREFIX}/${API_VERSION}` prefix every Nest controller sits behind (`src/main.ts:51-58`). A global `AuthGuard` (registered as `APP_GUARD` by `AuthModule.forRootAsync` in `src/app.module.ts:60-69`, from `@thallesp/nestjs-better-auth`) protects every other route by default.

```mermaid
sequenceDiagram
    participant Client
    participant Auth as Better Auth (/auth/*)
    participant Postgres
    participant Guard as AuthGuard (global)
    participant Controller

    Client->>Auth: POST /auth/sign-in/email
    Auth->>Postgres: verify credentials, create Session row
    Auth-->>Client: Set-Cookie (session token)

    Client->>Guard: GET /api/v1/routines (cookie attached)
    Guard->>Auth: auth.api.getSession({ headers })
    Auth->>Postgres: look up Session by token
    Postgres-->>Auth: session + user
    Auth-->>Guard: session
    Guard->>Guard: check @AllowAnonymous / @OptionalAuth / @Roles metadata
    Guard->>Controller: attach request.session, call handler
    Controller-->>Client: 200 (or 401/403 from the guard)
```

**Sign-in issues the cookie.** `POST /auth/sign-in/email` and `/auth/sign-up/email` are handled entirely by Better Auth's own middleware — there's no Nest controller in the path, which is also why these routes don't appear in the Swagger UI at `/docs` (see [Architecture decisions](architecture-decisions.md)).

**Every other request goes through `AuthGuard`.** `AuthGuard.canActivate` calls `auth.api.getSession({ headers })`, attaches the result to `request.session`/`request.user`, then applies decorator metadata in order: `@AllowAnonymous()` skips the session check entirely (e.g. `src/health/health.controller.ts:32,39`, since liveness/readiness probes can't authenticate); `@OptionalAuth()` allows an anonymous request through but still populates the session if one exists; otherwise a missing session throws `401`; `@Roles([...])` then checks the authenticated user's role and throws `403` if it doesn't match (e.g. `@Roles(['admin'])` on `TasksController`'s mutating routes, `src/tasks/tasks.controller.ts:25,41,50`). Controllers that need the authenticated user inject it with `@Session() session: UserSession` (`src/routines/routines.controller.ts:34` — `session.user.id` is what scopes every routines query to its owner; see [Core write](#core-write)).

**Rate limiting is Redis-backed but deliberately isolated from sessions.** `src/auth/auth.ts:135-142` configures `rateLimit.customRules` for `/sign-in/email` (5/min) and `/sign-up/email` (3/min), backed by `RedisRateLimitStorage` (`src/auth/redis-rate-limit-storage.ts`) wired as `rateLimit.customStorage` — **not** `secondaryStorage`, which Better Auth also uses for session/verification-token caching and would put PII in Redis (comment at `auth.ts:130-134` and `redis-rate-limit-storage.ts:26-30`). `consume()` (`redis-rate-limit-storage.ts:89-130`) runs a Lua script (`CONSUME_SCRIPT`, lines 17-24) doing an atomic `INCR` + conditional `EXPIRE` + `TTL` read in one round trip, and **fails open** on any Redis error — catches, logs a warning, and returns `{ allowed: true, retryAfter: null }` (lines 119-129), because Better Auth awaits this call inline with no timeout of its own, so a Redis outage must never block sign-in.

**Why it's built this way:** this is the one auth-adjacent Redis use that fails open by design, same as the [cached read](#cached-read) flow below — a rate-limit check is a non-critical guard, not a correctness requirement, so degrading to "unlimited" beats degrading to "can't sign in."

## Core write

Representative example: `POST /routines` (`src/routines/routines.controller.ts:32-38` → `RoutinesService.create`, `src/routines/routines.service.ts:73-90`).

```mermaid
sequenceDiagram
    participant Client
    participant Controller as RoutinesController
    participant Service as RoutinesService
    participant Postgres
    participant Producer as RoutineCreatedProducer
    participant RabbitMQ

    Client->>Controller: POST /routines { title, notes }
    Note over Controller: global ValidationPipe: whitelist + forbidNonWhitelisted
    Controller->>Service: create(session.user.id, dto)
    Service->>Postgres: routine.create({ data: { ...dto, userId } })
    Postgres-->>Service: Routine row (commit done)
    Service->>Producer: publish(routine)  (fire-and-forget, not awaited)
    Producer--)RabbitMQ: emit('routine.created', event)
    Service-->>Controller: Routine
    Controller-->>Client: 201 Routine
```

**Validation happens before the handler runs.** `CreateRoutineDto` uses `class-validator` decorators; the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` (`src/main.ts:61-67`) rejects any request body with unrecognized properties rather than silently dropping them.

**Ownership is enforced two different ways depending on the operation.** On `create`, ownership is established by writing `userId` directly into the row (`routines.service.ts:74-76`, `data: { ...dto, userId }` — there's nothing to check yet, the row doesn't exist). On every other operation, ownership is enforced by scoping the query itself to `{ id, userId }`: `findById` uses `findFirst({ where: { id, userId } })` and throws `NotFoundException` if nothing matches (`routines.service.ts:120-130`); `update` (`routines.service.ts:144-159`) and `remove` (`routines.service.ts:161-178`) use `updateMany`/`deleteMany` with the same `where` and check `count === 0`. A routine that exists but belongs to someone else is indistinguishable from a routine that doesn't exist — both return `404`, never `403`, so existence isn't leaked to non-owners.

**Prisma errors are translated locally, not globally.** `routines.service.ts:50-57` defines a local `isPrismaErrorCode` type guard (`error instanceof Prisma.PrismaClientKnownRequestError && error.code === code`) — duplicated verbatim in `tasks.service.ts` and `users.service.ts` rather than shared, deliberately (see [CLAUDE.md](../CLAUDE.md) — no shared exception filter). The mapping used across `RoutinesService`:

| Prisma code | Meaning here | Thrown as |
|---|---|---|
| `P2025` (record not found) | task not attached to routine on `updateTask`/`removeTask` | `NotFoundException` (lines 246-250, 272-275) |
| `P2002` (unique violation) | task already assigned, or its position is taken | `ConflictException` (`addTask` lines 211-214, `updateTask` lines 251-254) |
| `P2003` (FK violation) | deleting a routine that still has tasks attached | `ConflictException` (`remove`, lines 171-175) |
| `P2003` (FK violation) | attaching a task id that doesn't exist | `NotFoundException` (`addTask`, lines 216-218) — same Prisma code, opposite direction, so the exception depends on which side of the relation is missing |

**The event publish happens after the commit, and is never awaited.** `create()` awaits `prisma.routine.create(...)` first — the write is durable — then calls `this.routineCreatedProducer.publish(routine)` synchronously (`routines.service.ts:83-87`). The surrounding `try/catch` only guards a *synchronous* throw from `publish` itself; `publish` (`routine-created.producer.ts:26-58`) is fire-and-forget internally too (see [Asynchronous domain event](#asynchronous-domain-event)), so a RabbitMQ outage can never fail a `POST /routines` request.

**Why it's built this way:** this is the pattern documented in `CLAUDE.md` as "async domain events are fire-and-forget" and "ownership checks, not just auth" — copy this shape (query scoped to `{ id, userId }`, `404` on a miss, publish after commit) for any new user-scoped write.

## Cached read

Representative example: `GET /tasks` and `GET /tasks/:id` (`src/tasks/tasks.service.ts` `findAll`/`findById`).

```mermaid
sequenceDiagram
    participant Client
    participant Service as TasksService
    participant Redis
    participant Postgres

    Client->>Service: GET /tasks/:id
    Service->>Redis: safeCacheGet("tasks:<id>")
    alt cache hit
        Redis-->>Service: cached Task
        Service-->>Client: 200 Task
    else cache miss (or Redis error)
        Redis--x Service: undefined
        Service->>Postgres: task.findUnique({ id })
        Postgres-->>Service: Task
        Service->>Redis: safeCacheSet("tasks:<id>", task)
        Service-->>Client: 200 Task
    end
```

**Cache is checked before Postgres, on a per-key basis.** `findById` computes `taskCacheKey(id)` → `` `tasks:${id}` `` (`tasks.service.ts:167-169`) and calls `safeCacheGet` (line 112); a hit returns immediately without touching Postgres. `findAll` does the same with a versioned list key: `` `tasks:list:v${version}:${page}:${limit}:${category}:${difficulty}` `` (lines 171-180), so different filter/pagination combinations get distinct cache entries.

**List invalidation is a version bump, not a delete-by-pattern.** The generic `Cache` interface (`cache-manager`) has no way to enumerate or pattern-delete keys, so there's no way to directly invalidate every `tasks:list:*` entry after a write. Instead, `create`/`update`/`remove` all call `bumpListCacheVersion()` (lines 182-186), which increments a separate non-expiring counter key (`tasks:list:version`, `ttl: 0`) — every list-cache key embeds the *current* version at read time, so bumping it makes all previously-cached list keys unreachable going forward (they still exist in Redis but nothing will ever look them up again; they age out via the global `CACHE_TTL_MS`). `update`/`remove` additionally `safeCacheDel` the single-item key directly, since that one *is* addressable by id (lines 128-145, 147-165).

**Every cache operation fails open.** `safeCacheGet`/`safeCacheSet`/`safeCacheDel` (`tasks.service.ts:191-234`) each wrap the underlying `cache-manager` call in `try/catch`, log a warning, and return `undefined`/no-op rather than propagating — the comment at lines 188-190 states the rule directly: "Redis is an optimization here, not a dependency: on any cache failure we log and fall back to a miss/no-op so Postgres remains the source of truth." The Redis client backing the cache is also configured defensively at the connection level (`KeyvRedis` in `src/app.module.ts:43-55`): `disableOfflineQueue: true` plus a 2s `connectTimeout` so a dead Redis fails fast into `safeCacheGet`'s `catch` rather than hanging the request.

**Why it's built this way:** per `CLAUDE.md`'s "fail-open vs. fail-closed" convention — this is the fail-open default. The one deliberate exception in this codebase is `RedisLockService` guarding routine reorders, which fails *closed* (`503`) because proceeding without the lock risks corrupting task ordering; default to fail-open like this flow unless a new feature has that same correctness requirement.

## Asynchronous domain event

The one event this codebase publishes today: `routine.created`, emitted after `POST /routines` (see [Core write](#core-write)) and consumed in the same process.

```mermaid
sequenceDiagram
    participant Main as main.ts (bootstrap)
    participant DLQInit as RoutineEventsDeadLetterTopologyInitializer
    participant HTTP as Nest HTTP app
    participant MQ as Nest microservice (RMQ)
    participant Producer as RoutineCreatedProducer
    participant RabbitMQ
    participant Consumer as RoutineCreatedConsumer
    participant DLQ as routine_events.dlq

    Main->>HTTP: NestFactory.create(AppModule)
    Note over DLQInit: OnModuleInit, during module init
    DLQInit->>RabbitMQ: assert routine_events.dlx / routine_events.dlq
    Main->>MQ: app.connectMicroservice(routineEventsRmqOptions)
    Main->>MQ: await app.startAllMicroservices()
    Note over Main: must happen before app.listen()
    Main->>HTTP: app.listen(port)

    Producer--)RabbitMQ: emit("routine.created", event) [queue: routine_events_v2]
    RabbitMQ--)Consumer: deliver to durable queue
    Consumer->>Consumer: restore RequestContext from event.correlationId
    alt handler succeeds
        Consumer->>RabbitMQ: channel.ack(message)
    else handler throws
        Consumer->>RabbitMQ: channel.nack(message, false, false)
        RabbitMQ--)DLQ: dead-letter (via routine_events.dlx)
    end
```

**Queue name and routing pattern are deliberately two different strings.** `ROUTINE_EVENTS_QUEUE = 'routine_events_v2'` is the actual AMQP queue (renamed from `routine_events` — see the comment above the constant for why: RabbitMQ rejects redeclaring a durable queue whose arguments changed, and a still-live previous revision recreating the old queue on every autoscaled instance makes deleting it by hand a losing race); `ROUTINE_CREATED_PATTERN = 'routine.created'` (`routine-created.event.ts:3`) is the routing key/event-pattern used by both `client.emit(...)` and `@EventPattern(...)`. The producer's client registration (`routines.module.ts`, via `ClientsModule.registerAsync`) and the consumer's microservice registration (`main.ts`, via `app.connectMicroservice`) both call the same `routineEventsRmqOptions()` helper, which spreads the shared `ROUTINE_EVENTS_QUEUE_OPTIONS` constant (`src/routines/events/rabbitmq.constants.ts:35-46`) into each — rather than either side declaring its own literal. The comment there explains why: RabbitMQ rejects a queue redeclare whose options don't match the first declaration, so the two sides drifting apart would break at runtime, not at compile time.

**The message envelope is versioned and correlation-tagged.** `RoutineCreatedEvent` (`routine-created.event.ts:5-22`) carries `eventId` (a fresh `randomUUID()` per publish), `eventType`, `eventVersion: 1`, `occurredAt`, a `correlationId` propagated from the originating HTTP request, and a `data` payload trimmed to just `{ routineId, userId, title, status }` — not the full `Routine` row. The producer reads `correlationId` off the current `RequestContext` when publishing (falling back to a fresh `randomUUID()` only if `publish` is somehow called outside any request scope); the consumer restores it into its *own* `RequestContext` on delivery (see below), so every log line for this event — on either side of the queue — correlates back to the HTTP request that created the routine, the same mechanism `README.md`'s Observability section describes for HTTP requests generally.

**The producer is genuinely fire-and-forget.** `publish()` (`routine-created.producer.ts:26-58`) has a `void` return type, never `await`s anything, and calls `this.client.emit(...).subscribe({ next, error })` — `emit()` returns a hot RxJS observable that dispatches immediately without needing a subscriber. `next` increments the `queueMessagesPublishedTotal` metric on a successful dispatch; `error` logs a publish failure instead of letting it surface as an unobserved RxJS error — neither handler blocks or retries.

**The consumer restores correlation, then acks or dead-letters — it's no longer a bare logging placeholder.** `RoutineCreatedConsumer` (`routine-created.consumer.ts`) is a plain `@Controller()` with a single `@EventPattern(ROUTINE_CREATED_PATTERN)` handler. It restores a `RequestContext` scoped to the delivery (a fresh `requestId`, the `correlationId` from the envelope), and inside that scope: the handler body itself still just logs the event today (a placeholder for future side effects like notifications/analytics), but the surrounding ack/nack handling is real, not a placeholder. On success it manually **acks** the message (`channel.ack`) and increments `queueMessagesConsumedTotal`; on a thrown error it manually **nacks without requeue** (`channel.nack(originalMessage, false, false)`), incrementing `queueConsumerFailuresTotal`/`queueDeadLetteredTotal` — the `x-dead-letter-exchange` argument on the main queue (see below) means a nack-without-requeue always routes to the dead-letter queue rather than retrying forever or silently dropping the message. It's registered in the same `controllers: [...]` array as `RoutinesController` in `routines.module.ts`.

**The dead-letter exchange/queue are asserted separately, before the consumer starts.** RabbitMQ doesn't create `routine_events.dlx`/`routine_events.dlq` just because the main queue's `x-dead-letter-exchange` argument references them — something has to assert that topology explicitly. `RoutineEventsDeadLetterTopologyInitializer` (`dead-letter-topology.ts`, registered as a provider in `routines.module.ts`) does this via `OnModuleInit`, which Nest runs during module initialization — before `main.ts` calls `app.startAllMicroservices()` and the consumer's `ServerRMQ` asserts the main queue. It uses its own short-lived `amqplib` connection, separate from the amqp-connection-manager–backed client/consumer channels, and a failure here is logged rather than thrown so it can't block app bootstrap — though until it succeeds, a nacked message would be dropped instead of dead-lettered.

**No separate worker process exists for this.** The hybrid bootstrap in `src/main.ts:42-49` — `app.connectMicroservice(routineEventsRmqOptions(...))` then `await app.startAllMicroservices()`, called *before* `app.listen(port)` — runs the RabbitMQ consumer inside the exact same Node process and `Application` instance as the HTTP server. This is Nest's documented hybrid-application pattern, not a coincidence of shared code: there is one deployable, one process, one set of env vars.

**Why it's built this way:** contrast this with `src/weekly-routine-cleanup/`, which is a genuinely separate process (`NestFactory.createApplicationContext()`, no HTTP/microservice listener, its own `main.ts`, deployed as an independent Cloud Run Job). The rule from `CLAUDE.md`: a new async **consumer** for an existing or new domain event follows this hybrid in-process pattern; a new **scheduled batch job** follows the standalone pattern instead. Don't conflate the two.
