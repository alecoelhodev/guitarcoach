# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-alpine

# ---- base: shared manifest layer, isolated so `npm ci` caches independently of source changes ----
FROM node:${NODE_VERSION} AS base
WORKDIR /usr/src/app
COPY package.json package-lock.json ./

# ---- dependencies: full install (incl. devDependencies) for building/running in watch mode ----
FROM base AS dependencies
RUN npm ci

# ---- production-dependencies: prod-only install, built independently for a leaner final image ----
FROM base AS production-dependencies
RUN npm ci --omit=dev

# ---- development: hot-reload target used by compose.dev.yaml ----
FROM dependencies AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ---- build: compiles TypeScript -> dist/ ----
FROM dependencies AS build
COPY . .
RUN npm run build

# ---- production: minimal runtime image ----
FROM node:${NODE_VERSION} AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY package.json ./
COPY --from=production-dependencies /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
# compose.yaml's startup command runs `prisma migrate deploy` before the app
# starts listening, which needs the schema/migrations/config at runtime, not
# just what tsc compiled into dist/.
COPY --from=build /usr/src/app/prisma ./prisma
COPY --from=build /usr/src/app/prisma.config.ts ./prisma.config.ts
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/health/ready" || exit 1
CMD ["node", "dist/src/main"]
