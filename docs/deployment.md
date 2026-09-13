# Continuous deployment

The full CI/CD pipeline: one-time GCP project setup for Direct Workload Identity Federation, gotchas hit getting it working, and how to roll back a bad deploy. See [README.md](../README.md) for the rest of the API.

`.github/workflows/google-cloudrun-docker.yml` builds the API image, pushes it to Artifact Registry, and deploys it to Cloud Run on every push to `main`. `.github/workflows/ci.yml` runs format/lint/test/build on every PR. Both authenticate to Google Cloud via **Direct Workload Identity Federation** — no service account key ever exists as a GitHub secret; a GitHub Actions OIDC token is exchanged directly for short-lived GCP credentials, scoped to a specific repo.

```bash
# --- One-time GCP project setup ---

# Enable the APIs this workflow depends on
gcloud services enable run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  --project=PROJECT_ID

# Create the Workload Identity Pool + GitHub OIDC provider. attribute-condition
# restricts the whole pool to one GitHub org; individual role grants below
# narrow further to one specific repo via attribute.repository.
gcloud iam workload-identity-pools create github \
  --project=PROJECT_ID --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc REPO_NAME \
  --project=PROJECT_ID --location=global --workload-identity-pool=github \
  --display-name="GitHub repo Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'YOUR_GITHUB_ORG'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Every grant below targets this same principal: any workflow run from this
# one repo (a principalSet, not a service account — Direct WIF has no service
# account of its own on the CI side).
WIF_MEMBER="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/YOUR_GITHUB_ORG/REPO_NAME"

# Artifact Registry repo images are pushed to. Docker/Artifact Registry image
# references need FOUR path segments (HOST/PROJECT/REPOSITORY/IMAGE) — the
# workflow's REPOSITORY and SERVICE env vars fill the last two, and can be the
# same value if there's no need to distinguish them.
gcloud artifacts repositories create REPO_NAME \
  --repository-format=docker --location=REGION --project=PROJECT_ID
gcloud artifacts repositories add-iam-policy-binding REPO_NAME \
  --project=PROJECT_ID --location=REGION \
  --member="$WIF_MEMBER" --role="roles/artifactregistry.writer"

# Deploy access. roles/run.developer covers creating/updating revisions but
# NOT setting IAM policy on the service (no setIamPolicy permission) — the
# workflow's --allow-unauthenticated flag silently no-ops without the
# additional service-scoped roles/run.admin grant further down.
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="$WIF_MEMBER" --role="roles/run.developer"

# Dedicated least-privilege runtime SA for the deployed service — deliberately
# not the default compute SA, which typically carries a broad legacy
# roles/editor grant. Scoped to exactly what the app needs at runtime: object
# access to its own bucket, and its own secrets. No database IAM role — Postgres
# is Neon, outside GCP, reached with the credentials in DATABASE_URL.
gcloud iam service-accounts create SERVICE_NAME-api-runtime \
  --project=PROJECT_ID --display-name="SERVICE_NAME API Cloud Run runtime"
gcloud storage buckets add-iam-policy-binding gs://YOUR_BUCKET_NAME \
  --member="serviceAccount:SERVICE_NAME-api-runtime@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
gcloud iam service-accounts add-iam-policy-binding \
  SERVICE_NAME-api-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --project=PROJECT_ID --member="$WIF_MEMBER" --role="roles/iam.serviceAccountUser"

# Optional: only needed if/when METRICS_EXPORT_ENABLED=true (see
# docs/monitoring/README.md). Lets the runtime SA write OTel metrics to GCP
# Cloud Monitoring via its native OTLP endpoint.
gcloud services enable monitoring.googleapis.com --project=PROJECT_ID
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:SERVICE_NAME-api-runtime@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/monitoring.metricWriter"

# Production secrets. DATABASE_URL is Neon's POOLED endpoint (host contains
# "-pooler"), a plain public TLS host — no Cloud SQL connector, no VPC
# connector, no proxy. See "Provisioning the database (Neon)" below for where
# these two URLs come from and why there are two.
printf '%s' "postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/DB?sslmode=verify-full&schema=public" | \
  gcloud secrets create SERVICE_NAME-database-url --project=PROJECT_ID --data-file=-
printf '%s' "postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/DB?sslmode=verify-full&schema=public" | \
  gcloud secrets create SERVICE_NAME-direct-database-url --project=PROJECT_ID --data-file=-
openssl rand -base64 32 | gcloud secrets create SERVICE_NAME-better-auth-secret --project=PROJECT_ID --data-file=-
printf '%s' "rediss://default:PASSWORD@YOUR_REDIS_HOST:6379" | \
  gcloud secrets create SERVICE_NAME-redis-url --project=PROJECT_ID --data-file=-
printf '%s' "amqps://USER:PASSWORD@YOUR_RABBITMQ_HOST/VHOST" | \
  gcloud secrets create SERVICE_NAME-rabbitmq-url --project=PROJECT_ID --data-file=-
printf '%s' "YOUR_OPENAI_API_KEY" | \
  gcloud secrets create SERVICE_NAME-openai-api-key --project=PROJECT_ID --data-file=-
# Note the omission: SERVICE_NAME-direct-database-url is deliberately NOT in
# this list. The running app never migrates, so the runtime SA has no access to
# the unpooled URL — only the CI principal below does.
for SECRET in SERVICE_NAME-database-url SERVICE_NAME-better-auth-secret SERVICE_NAME-redis-url SERVICE_NAME-rabbitmq-url SERVICE_NAME-openai-api-key; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project=PROJECT_ID \
    --member="serviceAccount:SERVICE_NAME-api-runtime@PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# The deploy workflow's "Run database migrations" step reads the unpooled URL as
# the CI WIF principal, so that one grant goes to $WIF_MEMBER instead.
gcloud secrets add-iam-policy-binding SERVICE_NAME-direct-database-url \
  --project=PROJECT_ID --member="$WIF_MEMBER" \
  --role="roles/secretmanager.secretAccessor"

# Allow public invocation. The app's own global AuthGuard (Better Auth) is the
# real per-route authorization boundary — this only lets requests reach the
# container at all; without it, ONLY other GCP principals (never an end user's
# browser/mobile client, which can't mint a Google identity token) could ever
# reach the service. Requires the service-scoped run.admin grant above, since
# run.developer alone can't set IAM policy.
gcloud run services add-iam-policy-binding SERVICE_NAME \
  --region=REGION --project=PROJECT_ID \
  --member="$WIF_MEMBER" --role="roles/run.admin"
```

## Provisioning the database (Neon)

Postgres is [Neon](https://neon.com) serverless Postgres on its free plan, not Cloud SQL — nothing about the database lives in GCP any more, so there is no `gcloud sql` command, no `--add-cloudsql-instances` connector, no VPC connector, and no Cloud SQL Auth Proxy. The free plan gives 0.5 GB storage and 100 CU-hours/month per project, autoscales to 2 CU, and scales to zero after 5 minutes idle — it resumes automatically on the next connection (roughly half a second), with no manual unpause step.

One-time setup, in the Neon console:

1. Create a project in **AWS `us-east-1`** on **Postgres 17** (matching `postgres:17-alpine` in `compose.yaml`), with the database named `guitar_coach`. `us-east-1` is the closest Neon region to the `us-east1` Cloud Run service.
2. Copy **both** connection strings the console offers — the pooled one (host contains `-pooler`) and the direct/unpooled one — into the two Secret Manager entries in the block above.

Two connection strings, because they're used by different things:

| Secret | Endpoint | Read by |
| --- | --- | --- |
| `SERVICE_NAME-database-url` → `DATABASE_URL` | pooled | `PrismaService` at runtime, and the weekly cleanup job |
| `SERVICE_NAME-direct-database-url` → `DIRECT_DATABASE_URL` | direct | The Prisma CLI only, via `prisma.config.ts` — `migrate deploy` in CI, and the `/reset-prod-db` runbook |

The pooled endpoint is PgBouncer in transaction mode, which is what makes Cloud Run's per-instance connection pool safe but also what makes DDL unreliable — hence the split. `?pgbouncer=true` is *not* needed: Neon's pooler is PgBouncer ≥ 1.22, and Prisma 7 with the `@prisma/adapter-pg` driver adapter no longer requires it.

Two edits to make to the string Neon hands you before storing it:

- **Write `sslmode=verify-full`, not `sslmode=require`.** `pg-connection-string` (bundled with `pg`) already treats `require` as an alias for `verify-full`, and emits a `SECURITY WARNING` process warning every time it does. Spelling it out is both the accurate description of what happens and the quiet one. Neon's certificate chains to a public CA in Node's bundled trust store, so no `sslrootcert` is needed.
- **Drop `channel_binding=require`.** node-postgres parses it and then ignores it — channel binding needs `enableChannelBinding: true` passed in code, which this app doesn't do. Leaving the parameter in the URL advertises a protection that isn't actually in effect.

**Migrations run in CI, from the image being deployed.** The deploy workflow's `Run database migrations` step `docker run`s the freshly-built-and-pushed image with `./node_modules/.bin/prisma migrate deploy` (the production image ships the Prisma CLI plus `prisma/` and `prisma.config.ts` — `prisma` and `dotenv` are runtime dependencies). Running it from that image, rather than from a `npm ci` on the runner, guarantees the migration set applied is exactly the one baked into the revision about to serve traffic.

**The step runs before the deploy, so keep migrations additive.** For the few seconds between the migration landing and the new revision taking traffic, the *old* revision is running against the *new* schema. That's fine for expand-style changes (adding a nullable column, a new table, a new index) and is not fine for contract-style ones (dropping or renaming a column the old code still selects) — split those across two deploys: ship the code that stops using the column first, then the migration that drops it.

**k6 performance-test CI job (staging) — one-time setup:**

`.github/workflows/k6-performance.yml` (see [Performance testing](performance-testing.md)) reuses the exact WIF principal above, plus three additions of its own — a dedicated CI-only test-user identity (never a developer's personal account), least-privilege access to just that identity's two secrets, and a place to put the staging URL outside the workflow file:

```bash
# Dedicated CI-only test user credentials, alongside the app secrets above.
# The email/password here just need to be picked once — the k6 scripts
# themselves handle creating this user on their first run (sign-in-or-sign-up
# fallback in setup()), so no manual sign-up call or DB insert is needed.
printf '%s' "k6-perf-test@example.com" | \
  gcloud secrets create guitarcoach-k6-perf-test-email --project=PROJECT_ID --data-file=-
printf '%s' "YOUR_CHOSEN_PASSWORD" | \
  gcloud secrets create guitarcoach-k6-perf-test-password --project=PROJECT_ID --data-file=-

# Scoped to just these two secrets — the CI WIF principal gets no broader
# Secret Manager access than this.
for SECRET in guitarcoach-k6-perf-test-email guitarcoach-k6-perf-test-password; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project=PROJECT_ID \
    --member="$WIF_MEMBER" --role="roles/secretmanager.secretAccessor"
done
```

```bash
# One-time, via the GitHub UI or `gh`: a `staging` Environment holding the
# non-secret STAGING_BASE_URL variable (a URL isn't a credential, but keeping
# it out of the workflow file still makes it changeable without a code edit).
gh api repos/YOUR_GITHUB_ORG/REPO_NAME/environments/staging -X PUT
gh api repos/YOUR_GITHUB_ORG/REPO_NAME/environments/staging/variables \
  -X POST -f name=STAGING_BASE_URL -f value=https://guitarcoach-685026468764.us-east1.run.app
```

There is no separate staging project/service in this repo today — the value above is the same Cloud Run URL the deploy workflow already targets, used in its pre-production role since this application isn't serving real production traffic yet (see `performance-testing.md`'s "Continuous integration" section for why).

**Gotchas hit getting this working, in case they recur:**

- **Artifact Registry image paths need four segments**, `HOST/PROJECT/REPOSITORY/IMAGE` — a workflow that only sets `PROJECT/SERVICE` (three segments) fails at push time with `invalid tag ...: Missing image name`, not at deploy time, so it's easy to mistake for an IAM problem.
- **The Prisma Client for a custom `output` path isn't generated automatically.** Nothing in `npm ci`/`postinstall` runs `prisma generate` for a non-default output path (`src/generated/prisma` here); a Dockerfile that goes straight from `COPY . .` to `RUN npm run build` only "works" locally because that gitignored directory already exists on disk from a prior manual `prisma generate` — a clean CI checkout has no such directory, and `tsc` fails with `TS2307` across every file that imports from it.
- **`WORKLOAD_IDENTITY_PROVIDER` must be the full provider resource path**, ending in `/providers/PROVIDER_ID` — not `/subject/...` or any other suffix. `google-github-actions/auth` sends this value straight through as the OIDC `audience`; a malformed path fails at GCP's STS endpoint with an "Invalid value for audience" error that gives no hint which part is wrong.
- **`google-github-actions/auth` can't infer `project_id`** under Direct WIF (no `service_account`/`credentials_json` input to extract it from) — pass it explicitly, or every later `gcloud`-based step (e.g. `deploy-cloudrun`) fails with "The [project] resource is not properly specified."
- **A stray `$` immediately before a `${{ }}` expression** (e.g. `` `$${{ env.REGION }}` ``) is invisible in a diff but corrupts the tag at runtime: GitHub Actions' expression matcher consumes `${{ ... }}` starting from the *second* `$`, leaving a literal `$` behind for the shell to (mis)interpret as the start of a different variable.
- **RabbitMQ connectivity is a hard boot-blocker, Redis is not.** `main.ts` calls `app.startAllMicroservices()` (which connects to RabbitMQ) *before* `app.listen()`, with no connect timeout — an unreachable broker hangs the container until Cloud Run's startup probe kills it, surfacing as a generic "failed to start and listen on the port" error that looks identical to an env-validation crash. `RedisLockService.onModuleInit()` deliberately races its connect against a 2s timeout, so Redis being unreachable only logs a warning (see [Architecture decisions](architecture-decisions.md)).
- **Every variable required by `env.validation.ts` has to be mirrored into the deploy workflow's `env_vars`/`secrets` block.** Nothing links the two — a variable added to the Zod schema with no default passes CI (which sets its own env for `openapi:check`) and then crashes the next revision at boot with `Environment validation failed`, surfacing as the same generic "failed to start and listen on the port" as the RabbitMQ hang above. `CORS_ORIGINS` was the first variable to hit this. It's currently set to the service's own origin, which changes nothing versus the old implicit behavior — **replace it with the real web client's origin** when one is deployed, or every browser request from that client is rejected (see [Authentication](authentication.md#browser-clients--cors)).
- **`DIRECT_DATABASE_URL` is part of that same mirroring problem, in the other direction.** It's optional in the Zod schema (local, Compose, and e2e all run against a single unpooled Postgres and fall back to `DATABASE_URL`), so a missing value never fails validation — the deploy workflow's migration step just fails at `docker run` time with an unauthenticated-connection error instead. It is deliberately absent from the deploy step's `secrets:` block: the running app never migrates, so the revision has no access to the unpooled URL at all.
- **Don't put `DIRECT_DATABASE_URL` in a local `.env`.** `prisma.config.ts` prefers it over `DATABASE_URL` for every CLI command, so a remote value there quietly redirects `npx prisma migrate dev`/`reset`/`studio` at the remote database. `test/support/global-setup.ts` pins it to `TEST_DATABASE_URL` explicitly for exactly this reason — without that line, `npm run test:e2e` would migrate the remote database and then let each spec's `beforeEach` `deleteMany()` wipe it.
- **`/health/ready`'s database ping is given 3000ms, not Terminus's 1000ms default.** Neon scales to zero after ~5 minutes idle and takes roughly half a second to wake, and the default timeout is close enough to that to report `{"database":{"message":"timeout of 1000ms exceeded","status":"down"}}` on the first check after an idle period — a cold start, not an outage. `DATABASE_PING_TIMEOUT_MS` in `src/health/health.controller.ts` covers the wake. The smoke-test step would survive the shorter timeout anyway (it retries 5x with a 3s delay), but an uptime monitor polling the endpoint directly would not.

- **`roles/run.developer` doesn't include `run.services.setIamPolicy`.** A workflow step passing `--allow-unauthenticated` will deploy successfully (creating the revision *is* covered) but silently fail to apply the public-invoker binding, with no visible error in the Action's log — the fix is a separate, service-scoped `roles/run.admin` grant (as above), not a broader project-level role.

**What happens when a deploy fails, and how to roll back:**

- **A crashing or unhealthy new revision never receives traffic.** `deploy-cloudrun@v2` calls `gcloud run deploy` under the hood, which only routes traffic to a new revision once it passes Cloud Run's own container startup probe. If the new revision crashes or never binds its port — e.g. the RabbitMQ boot-blocker above, or a Zod env-validation crash — the "Deploy to Cloud Run" step itself fails, the whole workflow run goes red, and the previous revision keeps serving 100% of traffic untouched. No manual action is needed in this case.
- **The smoke-test step runs *after* traffic has already shifted.** The deploy step doesn't use `--no-traffic` or revision tagging, so a revision that *does* pass Cloud Run's shallow startup probe immediately gets 100% of production traffic — before the workflow's "Smoke test deployed revision" step (which additionally exercises `/health/ready`'s database ping) has run. So a smoke-test failure here means the bad revision is already live and serving real users; the workflow going red is a detection signal, not a preventive gate.
- **Manual rollback: `gcloud run services update-traffic`.** Find the last known-good revision with `gcloud run revisions list --service=SERVICE_NAME --region=REGION` (newest first), then shift traffic back to it instantly, without a new build/deploy:
  ```bash
  gcloud run services update-traffic SERVICE_NAME --region=REGION \
    --to-revisions=REVISION_NAME=100
  ```
  This doesn't delete the bad revision, so it stays around for a `gcloud run services logs read` postmortem.
