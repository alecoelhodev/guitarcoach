# Authentication

Full walkthrough for the `auth` module — sign-up/sign-in curls, roles, and bootstrapping the first admin. See [README.md](../README.md) for the rest of the API, or [Request flows](flows.md#authentication) for a step-by-step trace of the same mechanism against the actual code.

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

## Browser clients & CORS

A web client on an origin other than the API's own has to clear **two** independent checks before a cookie-bearing request succeeds, and both read the same `CORS_ORIGINS` variable:

1. **CORS** — `main.ts` calls `app.enableCors({ origin, credentials: true })`. `credentials: true` is what lets the browser send and store the session cookie at all, and it rules out a wildcard origin: browsers drop a credentialed response whose `Access-Control-Allow-Origin` is `*`, which is exactly what a bare `enableCors()` emits. So every origin has to be named.
2. **Better Auth's own origin check** — its `originCheckMiddleware` rejects any cookie-bearing non-GET whose `Origin` isn't trusted, answering `403 INVALID_ORIGIN`. Left alone it trusts only `BETTER_AUTH_URL`'s own origin, so a client that passes CORS still fails the actual `POST /auth/sign-in/email`.

`CORS_ORIGINS` is parsed once in `src/config/env.validation.ts` into a trimmed list, which `main.ts` hands to `enableCors()` and `app.module.ts` hands to `createAuth(..., trustedOrigins)`. One variable feeds both, so the two checks can't drift apart — an earlier version of this used a separate `BETTER_AUTH_TRUSTED_ORIGINS` variable, and the failure mode when the two disagreed was a passing preflight followed by a 403 on the request it was meant to allow.

```bash
# Multiple origins: comma-separated. Surrounding whitespace and empty entries
# are stripped, so this and "http://localhost:8081,https://app.example.com"
# are equivalent.
CORS_ORIGINS=http://localhost:8081, https://app.example.com
```

The app fails to boot if `CORS_ORIGINS` is missing or lists no usable origin — including in production, where it has to be set on the Cloud Run service (see [Continuous deployment](deployment.md)).

Native clients (iOS/Android, curl) send no `Origin` header and are subject to neither check.

**One known limitation for a cross-site deployment:** Better Auth's session cookie defaults to `SameSite=Lax`, which the browser honors independently of CORS. A frontend served from a different registrable domain than the API will sign in successfully and then have the browser refuse to store or send the cookie. Local dev doesn't hit this — `localhost:8081` → `localhost:3000` is same-site, since `SameSite` ignores the port. Serving the web client from the API's own domain avoids it; otherwise the cookie needs `advanced.defaultCookieAttributes: { sameSite: 'none', secure: true }` in `createAuth` (not configured today).

## Roles & admin access

Two roles: `user` (default for every new sign-up) and `admin`, enforced via the `@Roles(['admin'])` decorator from `@thallesp/nestjs-better-auth` on `UsersController`'s and `TasksController`'s mutating/listing routes. Backed by Better Auth's `admin` plugin (`src/auth/auth.ts`).

`role` is a server-only field — it is **not** accepted in the `/auth/sign-up/email` body (or any other client-facing endpoint). Every new user gets `role: "user"` regardless of what you send.

**Bootstrapping the first admin**: Better Auth's admin endpoints (`/auth/admin/set-role`, `/auth/admin/create-user`) always require an authenticated admin session when called over real HTTP — there's no way to promote the very first user through the API. Set it directly in the database once:

```bash
npx prisma studio   # opens http://localhost:5555
```

Open the `User` table and change that row's `role` to `admin`. (If you're on Docker Compose, remember the container's Prisma Client needs rebuilding after any schema change — see [Option A above](../README.md#option-a--docker-compose) — though editing existing data via Prisma Studio doesn't require that.)

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
