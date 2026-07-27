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

## Architecture notes

- Standard Nest module/controller/service structure; `src/main.ts` bootstraps `AppModule` via `NestFactory`.
- Unit tests (`*.spec.ts`) live alongside the code they test in `src/`; Jest's `rootDir` is `src`. E2E tests (`*.e2e-spec.ts`) live in `test/` with their own Jest config (`test/jest-e2e.json`).
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`. Notable rule overrides: `no-explicit-any` off, `no-floating-promises` and `no-unsafe-argument` are `warn` not `error`.
- TypeScript config targets ES2023, uses `nodenext` module resolution, and has `noImplicitAny: false` with `strictNullChecks: true` (not full `strict` mode).
