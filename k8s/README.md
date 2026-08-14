# Kubernetes (local, via kind)

Run the entire guitar-coach stack — API, Postgres, Redis, RabbitMQ, and the weekly routine-cleanup batch job — on a local [kind](https://kind.sigs.k8s.io/) cluster, reusing the existing Dockerfile unmodified. This is the first environment of a reusable Kubernetes structure; a future `k8s/overlays/staging`/`gke` overlay reuses `k8s/base/` as-is and only needs to swap the local overlay's infrastructure/config for managed equivalents (Cloud SQL, Memorystore, etc. — see [What changes for GKE later](#what-changes-for-gke-later)).

See `docs/specs/k9-migration.md` for the original requirements this implements.

## Prerequisites

- Docker Desktop (or another local Docker daemon) running.
- [`kind`](https://kind.sigs.k8s.io/) — `brew install kind`.
- `kubectl` — already ships with a recent Docker Desktop, or `brew install kubectl`.

## Why kind

The spec asks for a local cluster with a preference for `kind`. It was the right fit here: it needs nothing beyond the Docker daemon already used for local dev, creates and tears down in seconds, and its `kind load docker-image` command gives a simple, explicit "load image into the cluster" step without standing up a local registry. No reason to reach for Docker Desktop's built-in Kubernetes or Minikube instead.

**A note on `--context`**: if your machine's `kubectl` is already configured against some other cluster (local or remote), every command below passes `--context kind-guitar-coach` explicitly rather than relying on whatever the ambient current-context happens to be. This is cheap insurance — copy the commands as written rather than dropping the flag.

## Architecture

```text
                          Local Machine
                               │
                     kubectl port-forward
                               │
                               ▼
                    ┌─────────────────────┐
                    │   kind (Docker)     │
                    │  namespace:          │
                    │  guitar-coach-local  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   api Deployment    │
                    │  ┌────────────────┐ │
                    │  │ initContainer: │ │   (runs `prisma migrate deploy`
                    │  │    migrate     │ │    once, before the app starts)
                    │  └────────────────┘ │
                    │  ┌────────────────┐ │
                    │  │ container: api │ │   (also runs the RabbitMQ
                    │  │  (hybrid Nest  │ │    `routine.created` consumer
                    │  │   HTTP+RMQ)    │ │    in-process — no separate
                    │  └────────────────┘ │    worker pod exists in this app)
                    └────┬───────┬───┬────┘
                         │       │   │
              ┌──────────┘       │   └──────────┐
              ▼                  ▼              ▼
        postgres Service   redis Service   rabbitmq Service
              │                  │              │
              ▼                  ▼              ▼
        postgres pod        redis pod      rabbitmq pod
              │                                 │
              ▼                                 ▼
        postgres-data PVC                 rabbitmq-data PVC

                    ┌─────────────────────────────┐
                    │ weekly-routine-cleanup       │
                    │ CronJob ("5 0 * * 1" UTC)    │──▶ postgres Service
                    │ (own pod, runs and exits)    │
                    └─────────────────────────────┘
```

There is no separate "worker" pod: this app's only async consumer (the RabbitMQ `routine.created` handler) runs in-process inside the `api` container via `app.connectMicroservice()` (see `CLAUDE.md`'s "hybrid bootstrap" note) — translating it into a second Deployment would misrepresent how the app actually runs.

## `base` vs. `overlays/local`

- **`k8s/base/`** — portable *application workloads*: the `api` Deployment/Service, the `weekly-routine-cleanup` CronJob, and a ConfigMap holding only the handful of env vars that are genuinely the same in every environment (`NODE_ENV`, `PORT`, `API_PREFIX`, `API_VERSION`, `LOG_LEVEL`, `METRICS_EXPORT_ENABLED`, `ROUTINE_CLEANUP_TIME_ZONE`). Base references a Secret named `guitar-coach-secrets` by name but never defines it — that's entirely an overlay concern. Nothing in `base/` is aware of kind, Postgres-in-a-container, or any other local-only detail.
- **`k8s/overlays/local/`** — local-only infrastructure (Postgres/Redis/RabbitMQ Deployments, Services, PVCs), the Namespace, the local-specific ConfigMap additions (`REDIS_URL`, `BETTER_AUTH_URL`, `GCP_PROJECT_ID`, `GCS_RECORDINGS_BUCKET`, `OPENAI_MODEL`), the `guitar-coach-secrets` Secret (generated from a local, gitignored file), the `imagePullPolicy: Never` patches (kind-specific — a registry-backed overlay wouldn't want this), and the concrete image tag.

## Docker image workflow

Reuses the existing multi-stage `Dockerfile` unmodified — no new Kubernetes-specific Dockerfile.

```bash
# 1. Build the same production image compose.prod.yaml uses
docker build --target production -t guitar-coach-api:local .

# 2. Load it directly into the kind cluster's node (no registry involved)
kind load docker-image guitar-coach-api:local --name guitar-coach
```

Re-run both commands after any code change, then restart the Deployment (see [Restarting a workload](#restarting-a-workload)) — `kubectl apply -k` alone will not pick up a new image under the same tag.

## Cluster and deployment workflow

### Create the cluster

```bash
kind create cluster --name guitar-coach
kubectl config current-context   # sanity-check it printed kind-guitar-coach
```

### Create the local secrets file (once)

```bash
cp k8s/overlays/local/secrets.local.env.example k8s/overlays/local/secrets.local.env
# edit k8s/overlays/local/secrets.local.env with real local values —
# this file is gitignored and must never be committed.
```

`kubectl apply -k` (below) turns this file into the `guitar-coach-secrets` Secret automatically via kustomize's `secretGenerator` — no manual `kubectl create secret` step needed. (The spec's suggested `kubectl create secret generic ...` workflow is an equally valid alternative if you'd rather manage the Secret imperatively; this repo just prefers the declarative, reproducible-from-a-file version, since it survives a full `kind delete cluster` + recreate without extra manual steps.)

### Deploy

```bash
kubectl --context kind-guitar-coach apply -k k8s/overlays/local
```

### Inspect

```bash
kubectl --context kind-guitar-coach -n guitar-coach-local get pods
kubectl --context kind-guitar-coach -n guitar-coach-local get deployments
kubectl --context kind-guitar-coach -n guitar-coach-local get services
kubectl --context kind-guitar-coach -n guitar-coach-local get pvc
kubectl --context kind-guitar-coach -n guitar-coach-local get cronjob
```

### Debug

```bash
kubectl --context kind-guitar-coach -n guitar-coach-local describe pod <pod>
kubectl --context kind-guitar-coach -n guitar-coach-local logs <pod>
kubectl --context kind-guitar-coach -n guitar-coach-local logs -f <pod>
kubectl --context kind-guitar-coach -n guitar-coach-local logs <api-pod> -c migrate   # the migration initContainer specifically
kubectl --context kind-guitar-coach -n guitar-coach-local exec -it <pod> -- sh
```

Redis's own container logs (`logs -f deployment/redis`) only show startup/connection events at the default log level, not individual commands. To watch live cache activity while exercising the app, stream commands directly instead:

```bash
kubectl --context kind-guitar-coach -n guitar-coach-local exec -it deployment/redis -- redis-cli monitor
# then, in another terminal, hit a cached endpoint (e.g. GET /api/v1/tasks) via
# the API port-forward below — GET/SET commands appear here in real time
```

### Access the API

```bash
kubectl --context kind-guitar-coach -n guitar-coach-local port-forward service/api 3000:3000
# then curl/browse http://localhost:3000 as normal — same as running it via compose
```

RabbitMQ's management UI is also reachable, handy for inspecting the `routine_events_v2` queue and its `routine_events.dlq` dead-letter queue:

```bash
kubectl --context kind-guitar-coach -n guitar-coach-local port-forward service/rabbitmq 15672:15672
# open http://localhost:15672 — log in with the RABBITMQ_DEFAULT_USER/PASS from secrets.local.env
```

### Restarting a workload

```bash
kubectl --context kind-guitar-coach -n guitar-coach-local rollout restart deployment/api
```

Needed both after loading a new image build, and after editing `secrets.local.env` or `configmap-patch.yaml` — the Secret here has a fixed name (not a content-hash suffix), so edits don't trigger an automatic rollout the way a `configMapGenerator`/`secretGenerator`-with-hashing setup would.

### Run the weekly cleanup job on demand

The CronJob fires weekly (Monday 00:05 UTC, matching the production Cloud Scheduler trigger — see `docs/weekly-routine-cleanup.md`), which is impractical to wait for locally. Trigger one run manually instead — this is exactly what `gcloud run jobs execute` does in production, and the job is idempotent so it's always safe:

```bash
kubectl --context kind-guitar-coach -n guitar-coach-local create job --from=cronjob/weekly-routine-cleanup manual-test-run
kubectl --context kind-guitar-coach -n guitar-coach-local logs -f job/manual-test-run
```

### Delete resources / delete the cluster

```bash
kubectl --context kind-guitar-coach delete -k k8s/overlays/local
kind delete cluster --name guitar-coach
```

## Database persistence

Postgres and RabbitMQ each have a `PersistentVolumeClaim` bound to a kind-provisioned volume, so data survives a pod restart/recreate (but not a `kind delete cluster`, which destroys the whole cluster's storage). To verify:

```bash
# write some data via the API, then:
kubectl --context kind-guitar-coach -n guitar-coach-local delete pod -l app.kubernetes.io/name=postgres
# wait for the replacement pod to become Ready, then confirm the same data is still there
```

Both Postgres and RabbitMQ Deployments use `strategy: {type: Recreate}` rather than the default rolling update — with a `ReadWriteOnce` PVC, a rolling update tries to start the new pod before killing the old one and gets stuck `Pending`/`FailedAttachVolume` because the old pod still holds the volume.

### Seeding data

`npm run db:seed` (`tsx prisma/seed.ts`) is a Node/Prisma script, not SQL, so it can't run *inside* either pod: the `postgres` pod is plain `postgres:17-alpine` with no Node, and the `api` pod's production image strips `tsx` (a `devDependency`) via `npm ci --omit=dev` at build time. Run it from your local machine instead — it already has `tsx` via `npm install` — pointed at the in-cluster Postgres through a port-forward:

```bash
# In one terminal: forward the postgres Service to a local port. Use 5433,
# not 5432, to avoid colliding with compose.dev.yaml's own Postgres if
# that's also running locally.
kubectl --context kind-guitar-coach -n guitar-coach-local port-forward service/postgres 5433:5432

# In another terminal: run the seed script against that forwarded port,
# using the same POSTGRES_USER/PASSWORD/DB values from secrets.local.env.
# The inline DATABASE_URL override (rather than editing .env) keeps this a
# one-off that doesn't repoint your normal dev database.
DATABASE_URL="postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5433/<POSTGRES_DB>?schema=public" npm run db:seed
```

## Troubleshooting

- **Transient `CrashLoopBackOff`/non-`Ready` right after `kubectl apply -k`, that resolves on its own within ~30–60s**: expected. Docker Compose's `depends_on: condition: service_healthy` has no Kubernetes equivalent — nothing gates the `api` pod's main container on Redis/RabbitMQ being ready before it starts. The migration `initContainer` itself already retry-loops until Postgres is reachable (so the main container won't even start until the DB is up), but Redis/RabbitMQ connectivity is only checked once the app is already running, via `/health/ready`. Give it a minute before treating this as a real failure.
- **Migration `initContainer` stuck/erroring**: `kubectl logs <api-pod> -c migrate` — almost always means Postgres isn't reachable yet or `secrets.local.env`'s `DATABASE_URL` doesn't match the `POSTGRES_*` values in the same file.
- **`ImagePullBackOff` / `ErrImageNeverPull`**: the image wasn't loaded into kind (or was loaded under a different tag than `k8s/overlays/local/kustomization.yaml`'s `images:` field expects) — re-run the [Docker image workflow](#docker-image-workflow) commands.
- **`DATABASE_URL`/`REDIS_URL`/`RABBITMQ_URL` connection errors that aren't transient**: these are hand-typed literals with no interpolation — double check the hostnames (`postgres`, `redis`, `rabbitmq`) match the Service names exactly, and that credentials in the composed URLs match the raw `POSTGRES_*`/`RABBITMQ_DEFAULT_*` values in the same `secrets.local.env` file.
- **Recordings upload/download or AI practice-planner/routine-coach requests fail**: expected with the placeholder `GCP_PROJECT_ID`/`GCS_RECORDINGS_BUCKET`/`OPENAI_API_KEY` values — `/health/ready` still passes (there's no GCS/OpenAI health indicator), but those specific features need real credentials. Every other feature (auth, tasks, routines, practice sessions) works fully against the in-cluster Postgres/Redis/RabbitMQ.
- **`kubectl port-forward` goes silent (`Empty reply from server`) after a `rollout restart`/pod recreation**: expected — a `service/...` port-forward pins to whichever pod backed the Service at connect time and doesn't follow a replacement pod. Kill it (Ctrl-C) and re-run the `port-forward` command from [Access the API](#access-the-api).

## Kubernetes concepts, in this app's terms

- **Pod** — the running instance of one of this app's containers: one `api` pod (with its `migrate` initContainer), one `postgres` pod, one `redis` pod, one `rabbitmq` pod, and one short-lived pod per `weekly-routine-cleanup` run.
- **Deployment** — keeps the desired number of `api`/`postgres`/`redis`/`rabbitmq` pods running and handles rolling them out on an image/config change.
- **CronJob** — runs `weekly-routine-cleanup` on a schedule and exits; unlike a Deployment, its pod is meant to finish, not stay running.
- **Service** — stable DNS name and virtual IP for a set of pods. `DATABASE_URL`/`REDIS_URL`/`RABBITMQ_URL` all resolve through Service names (`postgres`, `redis`, `rabbitmq`) rather than `localhost`, exactly as the spec asks — this is Kubernetes' service-discovery mechanism replacing docker compose's own built-in DNS.
- **ConfigMap** — non-secret env vars (`guitar-coach-config`): portable defaults from `base/`, plus local-only additions patched in by the overlay.
- **Secret** — sensitive env vars (`guitar-coach-secrets`): DB/RabbitMQ credentials, `BETTER_AUTH_SECRET`, `OPENAI_API_KEY`. Generated locally from a gitignored file, never committed.
- **PersistentVolumeClaim** — durable storage for `postgres`/`rabbitmq` that survives a pod restart, backed by kind's default StorageClass.
- **Liveness Probe** (`/health/live`) — "is this process still alive, or should Kubernetes kill and restart the container?" This endpoint checks nothing but the process itself.
- **Readiness Probe** (`/health/ready`) — "should this pod receive traffic right now?" This one actually checks memory, disk, Postgres, Redis, and RabbitMQ connectivity. Docker Compose could only express one combined healthcheck per service; Kubernetes splitting these into two concepts is a real, first-time-visible difference here — a pod can be alive-but-not-ready (e.g. RabbitMQ briefly unreachable) without being killed and restarted for it.
- **Kustomize Base** — `k8s/base/`: the portable application-workload definitions, reusable unmodified by any future overlay.
- **Local Overlay** — `k8s/overlays/local/`: everything specific to running this on kind (Postgres/Redis/RabbitMQ containers, local secrets/config, kind's `imagePullPolicy: Never` requirement).

## What changes for GKE later

Nothing in `k8s/base/` needs to change. A future `k8s/overlays/gke` (or `staging`) overlay would:

- Not include the `postgres`/`redis`/`rabbitmq` Deployments/Services/PVCs at all — instead point `DATABASE_URL` (via that overlay's own Secret) at Cloud SQL (Unix socket via the Cloud SQL Auth Proxy sidecar, or a private IP — see `docs/deployment.md` for the existing Cloud Run equivalent) and `REDIS_URL`/`RABBITMQ_URL` at Memorystore/a managed RabbitMQ.
- Set its own `GCP_PROJECT_ID`/`GCS_RECORDINGS_BUCKET`/`OPENAI_MODEL` ConfigMap values and real `OPENAI_API_KEY`/`BETTER_AUTH_SECRET` Secret values (likely sourced from Secret Manager rather than a local file).
- Drop the `imagePullPolicy: Never` patches and instead pin `images:` to a real Artifact Registry tag.
- Use its own `namespace:` and resource requests/limits sized for real traffic.

The `api` Deployment, `api` Service, and `weekly-routine-cleanup` CronJob in `base/` stay exactly as they are — this is the entire point of the base/overlay split, and it's why `DATABASE_URL`/`REDIS_URL`/`RABBITMQ_URL` are plain env vars rather than anything kind- or Docker-specific.

## Limitations

- Single-replica Postgres/Redis/RabbitMQ with no HA, backups, replication, or clustering — a deliberate simplification for a local learning environment, not a production database story (see the spec's explicit scope).
- No Ingress/TLS — access is via `kubectl port-forward` only, per the spec.
- `GOOGLE_APPLICATION_CREDENTIALS` isn't wired up locally, so real GCS uploads/downloads aren't exercised (see [Troubleshooting](#troubleshooting)).
- Kustomize's `secretGenerator` here uses a fixed name (`disableNameSuffixHash: true`), so editing `secrets.local.env` requires a manual `kubectl rollout restart` (see [Restarting a workload](#restarting-a-workload)) rather than triggering one automatically.
