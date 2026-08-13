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
