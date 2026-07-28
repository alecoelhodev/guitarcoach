# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is a stock NestJS starter (generated via `@nestjs/cli`) with no application-specific code yet — `src/` only contains the default `AppModule` / `AppController` / `AppService`. Treat any architectural decisions as greenfield.

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

- Standard Nest module/controller/service structure; `src/main.ts` bootstraps `AppModule` via `NestFactory`.
- Unit tests (`*.spec.ts`) live alongside the code they test in `src/`; Jest's `rootDir` is `src`. E2E tests (`*.e2e-spec.ts`) live in `test/` with their own Jest config (`test/jest-e2e.json`).
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`. Notable rule overrides: `no-explicit-any` off, `no-floating-promises` and `no-unsafe-argument` are `warn` not `error`.
- TypeScript config targets ES2023, uses `nodenext` module resolution, and has `noImplicitAny: false` with `strictNullChecks: true` (not full `strict` mode).
