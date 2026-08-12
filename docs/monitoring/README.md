# Monitoring & alerting runbook

This is a manual/`gcloud`-driven runbook, matching how every other piece of GCP
infra in this repo is provisioned (Secret Manager, IAM, the runtime service
account — see `README.md`'s "Continuous deployment" section). There is no
Terraform/IaC for this project yet (see `CLAUDE.md`'s roadmap notes), so
nothing here is applied automatically — it's a set of `gcloud` commands and
policy definitions to run by hand, the same way Secret Manager secrets are
set up today.

## What exists after this implementation

- **Structured JSON logs** (`src/observability/`) on stdout/stderr, automatically
  collected by Cloud Run into Cloud Logging — no code-side log shipping to configure.
- **OTel metrics** (`src/observability/metrics/meters.ts`), exported to Cloud
  Monitoring via its native OTLP ingestion endpoint when `METRICS_EXPORT_ENABLED=true`
  (see `src/observability/metrics/metrics.module.ts`). Disabled by default —
  only enable where the runtime service account has `roles/monitoring.metricWriter`
  (see "One-time setup" below).
- **Security events**: a distinct, filterable subset of the structured logs
  (`meta.eventCategory: "security"`), emitted by `SecurityEventLogger`. These
  are NOT OTel metrics — they're log-shaped (named events, not counters), so
  they're turned into Cloud Monitoring signals via **log-based metrics**
  (see below), not custom metrics.
- **`/health/ready`**, now checking Postgres, Redis, and RabbitMQ (bounded
  ~500ms timeouts each) in addition to memory/disk — the natural target for
  a GCP Uptime Check.

## One-time setup (before enabling `METRICS_EXPORT_ENABLED=true` anywhere)

```bash
# Enable the Cloud Monitoring API on the project (if not already enabled).
gcloud services enable monitoring.googleapis.com --project=YOUR_PROJECT_ID

# Grant the existing Cloud Run runtime service account permission to write
# metrics. This is the same service account already used for Cloud SQL/GCS/
# Secret Manager access — see README's Continuous deployment section.
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:guitarcoach-api-runtime@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/monitoring.metricWriter"
```

Then set `METRICS_EXPORT_ENABLED=true` in the Cloud Run service's env vars
(alongside the existing `NODE_ENV`/`GCP_PROJECT_ID`/etc. — see the deploy
workflow). Metrics export fails open (`MetricsModule.onModuleInit`) — a
missing grant or network issue logs an error and the app keeps running
normally, it just won't have metrics until fixed.

**Important — metric naming**: GCP's OTLP ingestion path deprecated the old
`@google-cloud/opentelemetry-cloud-monitoring-exporter` package (see the
comment in `metrics.module.ts`) in favor of native OTLP, which lands custom
metrics under the `prometheus.googleapis.com/` metric-type domain rather than
the older `workload.googleapis.com/` domain. **Before applying any of the
OTel-backed alert policies below, open Cloud Monitoring's Metrics Explorer,
confirm the exact metric type string for each instrument in `meters.ts` (it
should look like `prometheus.googleapis.com/http_request_duration_ms/histogram`),
and update the policy JSON's `filter` accordingly.** The policies below use
that expected naming pattern but are not guaranteed byte-for-byte until
verified against a real export — this is called out explicitly rather than
asserted as certain, per this repo's "verify, don't guess" convention for
external platform behavior.

## Log-based metrics (for the log-shaped security signals)

These have no ambiguity — the filter is ours to define. Create them with:

```bash
gcloud logging metrics create security_auth_sign_in_failures \
  --config-from-file=docs/monitoring/log-based-metrics/auth-sign-in-failures.json \
  --project=YOUR_PROJECT_ID

gcloud logging metrics create security_admin_action_failures \
  --config-from-file=docs/monitoring/log-based-metrics/admin-action-failures.json \
  --project=YOUR_PROJECT_ID
```

## Uptime check (for "instance not ready")

```bash
gcloud monitoring uptime create guitar-coach-api-ready \
  --resource-type=uptime-url \
  --protocol=https \
  --host=YOUR_CLOUD_RUN_HOSTNAME \
  --path=/health/ready \
  --period=1 \
  --timeout=10s
```

Cloud Console's Uptime Check UI is honestly easier than assembling the
equivalent `gcloud monitoring policies create` JSON for the companion alert
policy on check failure — do that part in the console, or see
`docs/monitoring/alert-policies/instance-not-ready.json` for a template.

## Applying the alert policies

```bash
for policy in docs/monitoring/alert-policies/*.json; do
  gcloud alpha monitoring policies create --policy-from-file="$policy" --project=YOUR_PROJECT_ID
done
```

## Alert catalog

| Alert | Spec section 9 control | Backing signal | Starting threshold (configurable — no production baseline exists yet) |
|---|---|---|---|
| `instance-not-ready` | application instance not ready | Uptime check on `/health/ready` | 2 consecutive failures |
| `elevated-5xx-rate` | elevated API error rate | `http_requests_total` (statusCode ≥ 500) | >5% of requests over 5 min |
| `abnormal-latency-p95` | abnormal request latency | `http_request_duration_ms` | p95 > 2s over 5 min |
| `redis-dependency-failures` | Redis dependency failure | `redis_operation_failures_total` | >10 failures over 5 min |
| `rabbitmq-dlq-growth` | queue backlog / DLQ growth | `queue_dead_lettered_total` | >0 over 15 min (any dead-lettering is worth a look at this traffic volume) |
| `job-failure-spike` | worker/job failure spikes | `job_runs_total{outcome="failure"}` | >0 over 1 run (this job runs weekly — any failure is actionable) |
| `ai-error-rate` | AI provider error spikes | `ai_requests_total{outcome="error"}` | >10% of AI requests over 15 min |
| `ai-abnormal-latency` | abnormal AI latency | `ai_request_duration_ms` | p95 > 15s over 15 min |
| `security-auth-failures` | unusual authentication failures | `security_auth_sign_in_failures` log-based metric | >20 over 5 min (Better Auth's own rate limiter already caps this per-IP at 5/min; a broader spike suggests distributed credential stuffing) |

Explicitly **not** alerted on yet (documented gaps, not oversights):
- **Queue depth/backlog** (as opposed to DLQ growth) isn't exposed as an
  OTel metric — RabbitMQ's own management plugin (already enabled, see
  `compose.yaml`) exposes this natively; wire a Cloud Monitoring RabbitMQ
  integration or scrape the management API separately if this becomes needed.
- **AI cost** — only raw token counts are captured (`ai_tokens_total`), no
  dollar-cost estimation, per the explicit decision to avoid hardcoding
  volatile provider pricing (see `CLAUDE.md`).
- **Postgres dependency failure** as its own alert is covered by
  `instance-not-ready` (the readiness check pings Postgres) rather than a
  separate Postgres-specific alert — `db_query_duration_ms` exists for
  latency/slow-query visibility but has no failure counter today.

Alerts are intentionally coarse-grained and few — the goal is signal, not
alert fatigue (per spec section 9's explicit warning against that).
