---
description: Print the runbook for resetting and re-seeding the production guitar-coach-db Cloud SQL database
---

Output the runbook below to the user verbatim (as markdown), filling in nothing and asking nothing first. Do not run any of these commands yourself and do not fetch the `guitarcoach-database-url` secret — this project's convention is that the operator runs every step themselves, in their own terminal, so the DB password never has to pass through the assistant.

Lead with one bolded sentence reminding the user that `guitar-coach-db` / `guitar_coach` is the **production** database that the live Cloud Run service reads from (see `.github/workflows/google-cloudrun-docker.yml`) — running step 4 deletes and replaces all of its current data.

Then output this runbook:

1. Install the proxy once (skip if already installed):
   `gcloud components install cloud-sql-proxy`

2. Terminal 1 — start the tunnel (uses your own gcloud IAM identity, requires `roles/cloudsql.client` on your account, no firewall/network changes on the instance):
   `cloud-sql-proxy guitar-coach-504400:us-central1:guitar-coach-db --port 5433`
   Leave this running.

3. Terminal 2 — fetch the app DB password and build a locally-hosted connection string (the stored secret is shaped for Cloud Run's unix-socket connection, so it needs re-hosting to the local proxy port):
   `gcloud secrets versions access latest --secret=guitarcoach-database-url`
   Take the password from that output (user `guitar_coach_app`, db `guitar_coach`), then:
   `export DATABASE_URL="postgresql://guitar_coach_app:<PASSWORD_FROM_SECRET>@127.0.0.1:5433/guitar_coach?schema=public"`

4. From the `guitar-coach` project root:
   `npx prisma migrate reset`
   This drops/recreates the `public` schema, reapplies every migration, then automatically runs `prisma/seed.ts` (wired as `package.json`'s `prisma.seed` script). Keep the interactive confirmation prompt — don't pass `--force`.

5. Clean up:
   `unset DATABASE_URL`
   Then `Ctrl+C` the proxy in terminal 1.
