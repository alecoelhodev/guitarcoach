---
description: Use before implementing any feature that requires provisioning new infrastructure or an external service (a cloud resource, bucket, queue, service account, IAM role/permission, credential, or a new env var tied to an external system). Produces a manual/CLI/env-var/production checklist and pauses for confirmation before writing application code.
---

## When this applies

Trigger whenever a task can't be satisfied purely by writing application code because it needs a resource, credential, or permission that doesn't already exist in the running dev environment — for example: a new GCP resource (bucket, API enablement, service account, IAM binding), a new Redis/RabbitMQ resource, a new Cloud Run Job/service, or any new env var tied to an external system.

Do **not** trigger for things that stay entirely inside the app: a new DB table/column (handled by `prisma migrate`), a new HTTP endpoint, or business logic that only touches existing infra.

## Instructions

1. **Stop before writing implementation code.** First produce a concise, step-by-step checklist, clearly separated into these four sections:
   1. **Manual steps** — what the user must complete themselves in the provider console (e.g. GCP Console): creating/selecting a project, enabling APIs, creating resources that need console-only confirmation, etc.
   2. **CLI commands** — the equivalent steps runnable via CLI (e.g. `gcloud`), for anything scriptable. Use placeholders (`PROJECT_ID`, `REGION`, etc.) the same way `README.md`'s existing "One-time GCP project setup" section does.
   3. **Environment variables** — the exact env vars the NestJS app requires for this feature. Cross-reference `src/config/env.validation.ts` (the single source of truth for env vars per `CLAUDE.md`) and `.env.example` so names match what the app actually reads — never invent a var name without checking these files first.
   4. **Production recommendations** — how auth/credentials should work in production, not local dev. This repo deploys to Cloud Run, so prefer Workload Identity / attached service accounts over downloaded JSON keys in production, mirroring the existing `weekly-routine-cleanup` Cloud Run Job setup in `README.md`.

2. **Always apply these constraints** to every checklist:
   - Principle of least privilege — grant only the specific permissions the feature needs.
   - Never recommend public bucket/resource access.
   - Never recommend broad roles like Owner or Editor — name the specific minimal IAM role(s) required instead.

3. **Pause after presenting the checklist.** Do not create modules, services, DTOs, or any other application code yet. Wait for the user to confirm the infrastructure has been provisioned before proceeding to implementation — even if the rest of the task otherwise looks straightforward.

## Example shape (adapt to whatever infra the task actually needs)

For a "store uploaded audio in Cloud Storage" style task, the checklist would look like: select/create a GCP project → enable the Cloud Storage API → create a private bucket in an appropriate region → create a local-dev service account → grant it a minimal bucket-scoped role (e.g. `roles/storage.objectAdmin` on that bucket, not project-wide) → create and download a key for local dev only → set the resulting env vars → configure Application Default Credentials where appropriate → verify access with a simple upload-then-delete smoke test.

Adapt the same four-section shape for other infra (Redis, RabbitMQ, a different GCP service, etc.) rather than reusing this example verbatim when it doesn't fit.
