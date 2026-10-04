---
description: Print the runbook for resetting the production guitar-coach Neon database
---

Output the runbook below to the user verbatim (as markdown), filling in nothing and asking nothing first. Do not run any of these commands yourself and do not fetch the `guitarcoach-direct-database-url` secret — this project's convention is that the operator runs every step themselves, in their own terminal, so the DB credentials never have to pass through the assistant.

Lead with one bolded sentence reminding the user that this Neon database is the **production** database that the live Cloud Run service reads from (see `.github/workflows/google-cloudrun-docker.yml`) — running step 3 deletes and replaces all of its current data.

Then output this runbook:

1. Fetch the direct (unpooled) connection string. `prisma migrate reset` runs DDL, so it must not go through Neon's pooled endpoint:
   `gcloud secrets versions access latest --secret=guitarcoach-direct-database-url`

2. Export it as `DATABASE_URL` for the CLI:
   `export DATABASE_URL="<VALUE_FROM_SECRET>"`
   (Export it as `DATABASE_URL`, not `DIRECT_DATABASE_URL` — `prisma.config.ts` reads either, and using `DATABASE_URL` keeps it out of your shell's longer-lived environment under the name the app itself uses.)

3. From the `guitar-coach` project root:
   `npx prisma migrate reset`
   This drops/recreates the `public` schema and reapplies every migration. It does **not** seed: Prisma 7 removed automatic seeding from `migrate reset` (and its `--skip-seed` flag with it), so the database comes back empty. Keep the interactive confirmation prompt — don't pass `--force`.

   **Never seed production.** Do not run `npx prisma db seed`, `npm run db:seed` or `npx tsx prisma/seed.ts` against this database: `prisma/seed.ts` creates an admin and four users that share a password committed to this public repo, so seeded accounts must never exist in prod. The seed refuses any non-local `DATABASE_URL` unless `SEED_ALLOW_NON_LOCAL=true` is set — never set it here.

4. Clean up:
   `unset DATABASE_URL`

Note there is no proxy or tunnel step any more: Neon is a public TLS endpoint, so `cloud-sql-proxy` is no longer part of this runbook. If you want a point-in-time copy before resetting, Neon's console can branch the database first — that is cheaper and faster than a `pg_dump`.
