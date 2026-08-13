# Weekly routine cleanup job

Selection/idempotency rules and the full one-time GCP setup for the standalone Cloud Run Job. See [README.md](../README.md) for the rest of the API.

A standalone, HTTP-less NestJS process (`src/weekly-routine-cleanup/`) that archives routines left `active` from before the current week, so every user starts the week with a clean routine list. It runs separately from the API — as a scheduled Google Cloud Run Job, not the in-process hybrid pattern used for the RabbitMQ consumer.

**Selection rule:** a routine is archived only if `status = active AND createdAt < currentWeekStart`. Routines created during the current week, and routines already `archived`, are left untouched. (This schema currently has no `completed` status — only `active`/`archived` — so there's nothing else to leave unchanged.)

**Week boundary:** "current week" starts Monday 00:00:00 in `ROUTINE_CLEANUP_TIME_ZONE` (default `UTC` — this repo has no other established app timezone). The boundary is computed with `Intl.DateTimeFormat`/`Date` only (no date library dependency), and is DST-correct: it resolves the target Monday's own UTC offset, not "now"'s. `CLEANUP_WEEK_START` (ISO 8601) overrides this for local testing or a one-off manual rerun with a specific boundary — it must never be set on the scheduled job itself.

**Idempotency:** archiving only ever matches `status: active`, so once a routine flips to `archived` it's excluded from every later run — rerunning the job any number of times is safe.

```bash
# Local run against your dev DATABASE_URL
npm run weekly-routine-cleanup

# --- One-time GCP project setup ---

# Enable the APIs this job's deploy/schedule steps depend on
gcloud services enable run.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  --project=PROJECT_ID

# Create the Artifact Registry repo images are pushed to (shared with the API
# image below — same repo, same `api` image name, this job just overrides the
# container command at deploy time).
gcloud artifacts repositories create guitar-coach \
  --repository-format=docker --location=REGION --project=PROJECT_ID

# Let Docker push to Artifact Registry
gcloud auth configure-docker REGION-docker.pkg.dev

# Create the job's runtime service account (referenced by --service-account
# below). No project-level IAM roles needed yet — it only needs read access
# to the DATABASE_URL secret, granted next.
gcloud iam service-accounts create weekly-routine-cleanup-job \
  --project=PROJECT_ID \
  --display-name="Weekly routine cleanup Cloud Run Job"

# Store the production DATABASE_URL as a secret and grant the job's service
# account access to it. Must exist before `gcloud run jobs create` below,
# which references it via --set-secrets.
printf '%s' "postgresql://USER:PASSWORD@HOST:5432/DB" | \
  gcloud secrets create weekly-routine-cleanup-database-url \
  --project=PROJECT_ID --data-file=-
gcloud secrets add-iam-policy-binding weekly-routine-cleanup-database-url \
  --project=PROJECT_ID \
  --member="serviceAccount:weekly-routine-cleanup-job@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
# Network reachability from Cloud Run to wherever Postgres is hosted (Cloud
# SQL private/public IP via a VPC connector or the Cloud SQL Auth Proxy, vs.
# an externally hosted Postgres reachable over the public internet with SSL)
# is a separate concern this repo doesn't prescribe — configure whatever the
# chosen DATABASE_URL target actually requires.

# Deploy as a Cloud Run Job using the SAME image/tag you already build and
# push for the API — the job only overrides the container command below, so
# there's no separate image to build. `--target production` is required (not
# `development`): that stage is the only one that runs `npm run build`, so
# it's the only one containing dist/ at all — view pushed tags at
# console.cloud.google.com/artifacts or
# `gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/guitar-coach`.
# --platform linux/amd64 is required when building on Apple Silicon (or any
# non-amd64 host) — Cloud Run only runs linux/amd64 images, and Docker
# otherwise defaults to the host's own architecture, which fails at deploy
# time with "Container manifest ... must support amd64/linux".
docker build --platform linux/amd64 --target production -t REGION-docker.pkg.dev/PROJECT_ID/guitar-coach/api:TAG .
docker push REGION-docker.pkg.dev/PROJECT_ID/guitar-coach/api:TAG

gcloud run jobs create weekly-routine-cleanup \
  --image=REGION-docker.pkg.dev/PROJECT_ID/guitar-coach/api:TAG \
  --region=REGION \
  --service-account=weekly-routine-cleanup-job@PROJECT_ID.iam.gserviceaccount.com \
  --command=node --args=dist/src/weekly-routine-cleanup/main.js \
  --set-secrets=DATABASE_URL=weekly-routine-cleanup-database-url:latest \
  --set-env-vars=ROUTINE_CLEANUP_TIME_ZONE=UTC \
  --max-retries=0 --task-timeout=5m --cpu=1 --memory=512Mi

# Run on demand, any time (safe — the job is idempotent)
gcloud run jobs execute weekly-routine-cleanup --region=REGION

# Create the identity Cloud Scheduler uses to invoke this job, and grant it
# permission to invoke — scoped to this specific job, not project-wide.
# Must happen after the job above exists.
gcloud iam service-accounts create routine-cleanup-scheduler-invoker \
  --project=PROJECT_ID \
  --display-name="Cloud Scheduler invoker for weekly-routine-cleanup"
gcloud run jobs add-iam-policy-binding weekly-routine-cleanup \
  --region=REGION \
  --member="serviceAccount:routine-cleanup-scheduler-invoker@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Schedule it for every Monday at 00:05 (must match ROUTINE_CLEANUP_TIME_ZONE's
# time zone, or the job fires at the wrong local wall-clock time)
gcloud scheduler jobs create http weekly-routine-cleanup-trigger \
  --location=REGION --schedule="5 0 * * 1" --time-zone="UTC" \
  --uri="https://REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT_ID/jobs/weekly-routine-cleanup:run" \
  --http-method=POST \
  --oauth-service-account-email=routine-cleanup-scheduler-invoker@PROJECT_ID.iam.gserviceaccount.com

# Inspect executions and logs
gcloud run jobs executions list --job=weekly-routine-cleanup --region=REGION
gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=weekly-routine-cleanup' --limit=50
```
