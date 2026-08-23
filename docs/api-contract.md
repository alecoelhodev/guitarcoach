# API contract (OpenAPI)

The API's contract is a **committed artifact**: `openapi.json` at the repo root is generated from the Nest controllers/DTOs and checked into git, and CI fails if it drifts from the code. That file — not this repo's TypeScript types, and not a hand-written spec — is the single source of truth any frontend or other client generates against. See [README.md](../README.md) for the API itself, and [Architecture decisions](architecture-decisions.md) for why Swagger sits where it does.

Two things expose the same document:

- **Swagger UI at `/docs`**, built at request time from the running app (`src/main.ts`) — for browsing/trying endpoints during development.
- **`openapi.json`**, written by `scripts/generate-openapi.ts` — for codegen and for reviewing contract changes in a diff.

Both share one `DocumentBuilder` (`src/swagger.config.ts`) and one `applyGlobalPrefix()` (`src/global-prefix.ts`), so the metadata and the route prefix can't drift between them.

## Generating and checking

```bash
npm run openapi:generate   # nest build && node dist/scripts/generate-openapi.js -> writes openapi.json
npm run openapi:check      # regenerate, then `git diff --exit-code openapi.json`
```

`openapi:check` is what runs in CI (`.github/workflows/ci.yml`, in the `build-and-test` job after `npm run build`), so **any change to a controller route, request DTO, or response DTO must be committed together with the regenerated `openapi.json`** — otherwise the build fails with a diff on that file. That gate is the whole BE↔FE sync mechanism: it makes a contract change impossible to merge silently.

The generator boots the real `AppModule` (`NestFactory.create`) but never calls `app.listen()`, and it needs **no live infrastructure** — no Postgres, Redis, RabbitMQ, GCS, or a real OpenAI key. It does need every variable in `src/config/env.validation.ts` to be *present* (Zod validates at module init), which is why the CI step passes a block of placeholder values.

Two of those values genuinely affect the output: `API_PREFIX` and `API_VERSION` end up in every path (and `API_VERSION` in `info.version`), because the script applies the same global prefix the running app does — via the shared `applyGlobalPrefix()` helper in `src/global-prefix.ts`, which `main.ts` also calls, so the prefix and its exclusions can't drift between the served routes and the documented ones. Placeholder values for the rest are inert, but those two have to match production (`api`/`v1`), which is why CI pins them explicitly rather than relying on the Zod schema's defaults.

Two further deliberate details in that script, both mirroring `src/main.ts`:

- It registers its own `process.on('unhandledRejection', ...)` handler, because importing `AppModule` pulls in `@openai/agents-core`, whose `TraceProvider` force-exits the process when it's the only listener (see the Architecture notes in [CLAUDE.md](../CLAUDE.md)).
- It logs, but ignores, an error thrown by `app.close()`. Without live infra, teardown hooks such as `RedisLockService.onModuleDestroy` throw (`ClientClosedError: The client is closed`) after the file has already been written. That is not a failed run.

## Response DTOs are the contract

Every controller method's return type is an explicit `*ResponseDto` class in the module's `dto/` folder — never a Prisma model (`Task`, `Routine`, `User`, …) and never a service-local interface. This is what makes the generated document useful: the `@nestjs/swagger` CLI plugin (enabled in `nest-cli.json`) infers property names, types, and optionality from those classes at compile time, while a Prisma type or an interface produces an unnamed/empty schema instead.

That plugin only runs inside `nest build`/`nest start` — which is why `openapi:generate` compiles first and runs `dist/scripts/generate-openapi.js`, rather than executing the script through `tsx` like the other standalone entrypoints in this repo.

Conventions to follow when adding an endpoint:

- **Naming**: `<resource>-response.dto.ts` holding `XResponseDto`, plus `PaginatedXResponseDto` (`{ data: X[]; meta: PaginationMetaDto }`) for list endpoints. `PaginationMetaDto` is shared from `src/common/dto/pagination-meta.dto.ts` — reuse it rather than redeclaring `{ total, page, limit, totalPages }`.
- **Nullable/optional and enum fields need an explicit `@ApiProperty`** — `@ApiProperty({ required: false, nullable: true })` for `foo?: T | null`, `@ApiProperty({ enum: SomeEnum })` for a Prisma enum, `@ApiProperty({ type: () => [ChildDto] })` for a nested array. Everything else is inferred.
- **Whitelist fields by hand where a raw row would over-expose.** `UserResponseDto` lists its fields out explicitly (see the comment in `src/users/dto/user-response.dto.ts`): secrets live on the separate `Account` model today, and enumerating fields keeps that true if the `User` model later grows one.
- **`GET /users/me` is modeled separately** (`MeResponseDto`) from the admin-facing `UserResponseDto`. It returns Better Auth's session user, which exposes a canonical `name` field where the Prisma row has `displayName`, and doesn't guarantee the admin plugin's ban fields — same account, different shape.
- **Union responses use an explicit `oneOf`.** `POST /ai/practice-planner` returns a discriminated union on `status`; Swagger has no native support for that, so each variant is its own DTO class registered with `@ApiExtraModels(...)` on the controller and wired together via `@ApiResponse({ schema: { oneOf: [...] } })` with `getSchemaPath()`. Merging the variants into one class would make every field look optional. Follow this pattern for any new union-returning endpoint.

Note that the DTO classes are **types, not runtime transforms** — there is no `ClassSerializerInterceptor`, and services still return Prisma rows structurally typed as the DTO. The DTO narrows what the contract *promises*; if you need a field to actually be absent from the response body, narrow the Prisma query (`select`) too.

## Consuming it from a frontend

There is no frontend in this repo yet. When one exists, the intended workflow is:

1. The frontend generates its client/types from `openapi.json` (e.g. [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) for types, or an HTTP-client generator) as a build/CI step — never hand-written interfaces mirroring these DTOs, which would silently rot.
2. Because `openapi.json` is committed, a backend contract change is visible as a reviewable diff on one file, and the frontend picks it up by regenerating against the updated file rather than by reading a changelog.

Four caveats a client has to handle, all of which are properties of the current document rather than oversights to work around silently:

- **Paths include the `/api/v1` prefix, but `servers` is empty.** The document's paths match what the app serves (`/api/v1/tasks`), so a client only needs an origin (`http://localhost:3000`) as its base URL, not a path prefix. `health/live` and `health/ready` are deliberately *not* prefixed — they're excluded in `applyGlobalPrefix()`, and appear at the root in the document exactly as they do at runtime.
- **Better Auth's `/auth/*` endpoints are absent.** They're raw Express middleware, not Nest controllers, so nothing can introspect them — sign-up/sign-in/sign-out are documented in [Authentication](authentication.md) and must be hand-written on the client.
- **Auth is not described in the document** — there's no `securitySchemes` entry, because authentication is a Better Auth session **cookie**. Every generated call to a non-`@AllowAnonymous()` route needs credentialed requests (`fetch(..., { credentials: 'include' })` or the equivalent), and a missing/invalid session returns `401`.
- **Only success responses are documented** (`200`/`201`/`204`, plus health's `503`). Error bodies are normalized globally by `src/observability/http-exception.filter.ts` and aren't in the schema, so a client can't generate its error type — treat that filter's shape as the error contract.

## When adding or changing an endpoint

1. Add/adjust the request DTO (`class-validator`) and the `*ResponseDto`, and type the controller method with the response DTO.
2. Run `npm run openapi:generate` and commit the resulting `openapi.json` in the same change. Never hand-edit that file.
3. Skim the diff on `openapi.json` as part of self-review — it is the clearest statement of what a client will see, and a surprising diff (a schema that turned into `{}`, a field that became optional) usually means a missing `@ApiProperty`.
