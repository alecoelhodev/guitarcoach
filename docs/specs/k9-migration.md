# Claude Prompt — Local Kubernetes Setup with Reusable Deployment Structure

Create a Kubernetes setup for this existing application so I can run the **entire containerized app locally on Kubernetes**.

This work will live on a separate experimental branch, for example:

`k9`

The local setup should be the first environment of a Kubernetes structure that can later be reused for deployment to GKE or another Kubernetes environment.

Do not deploy to GCP yet.

## Main goals

I want to:

* run the existing application locally in Kubernetes
* understand how the application's services communicate inside Kubernetes
* practice Deployments, Services, ConfigMaps, Secrets, volumes, probes, service discovery, logs, exec, and port forwarding
* reuse the existing Docker/container setup
* avoid changing application business logic
* create Kubernetes configuration that can later become the foundation for staging/production deployment

Keep the implementation simple and practical.

---

# Before Making Changes

Inspect the repository first.

Identify:

* all Dockerfiles
* Docker Compose configuration
* NestJS API
* workers
* background jobs
* PostgreSQL
* Redis
* RabbitMQ
* existing health endpoints
* environment variables
* ports
* container dependencies
* startup commands
* existing scripts
* any Cloud SQL-specific configuration
* any local-development configuration that differs from deployed environments

Understand how the application currently runs with Docker before translating it to Kubernetes.

Do not redesign the application.

---

# Local Kubernetes Platform

Prefer **kind** for the local Kubernetes cluster unless the repository or current development environment makes another option significantly simpler.

If you choose something else such as Docker Desktop Kubernetes or Minikube, explain why.

Do not introduce a cloud Kubernetes cluster.

---

# Kubernetes Structure

Do NOT put everything into a disposable `k8s/local` folder.

Create a reusable structure using **Kustomize**:

```text
k8s/
├── base/
│   ├── ...
│   └── kustomization.yaml
│
└── overlays/
    └── local/
        ├── ...
        └── kustomization.yaml
```

Use the built-in Kubernetes/Kustomize workflow.

The local environment should run with:

```bash
kubectl apply -k k8s/overlays/local
```

Do not introduce Helm.

---

# Base Layer

`k8s/base/` should contain Kubernetes resources that are portable across environments.

Where applicable, this should include things such as:

* API Deployment
* API Service
* Worker Deployment
* other application worker/job Deployments if they are long-running workloads
* ConfigMap definitions or references
* Secret references
* container ports
* environment configuration
* health probes if the application already supports them
* common labels/selectors

The base should represent the **application workloads**, not environment-specific infrastructure.

Design the base so it can reasonably be reused later by:

```text
k8s/overlays/local
k8s/overlays/staging
k8s/overlays/production
```

But only create the **local** overlay now.

Do not create staging or production overlays yet.

---

# Local Overlay

`k8s/overlays/local/` should contain local-specific configuration.

Depending on what the existing application actually requires, this may include:

* PostgreSQL
* Redis
* RabbitMQ
* local ConfigMap overrides
* local Secret configuration
* local image configuration
* PersistentVolumeClaims
* local resource configuration

Use Kubernetes Services so the application communicates through Kubernetes DNS.

For example, instead of:

```text
localhost:5432
localhost:6379
localhost:5672
```

the Kubernetes environment may use service names such as:

```text
postgres:5432
redis:6379
rabbitmq:5672
```

Use names appropriate to the actual manifests.

---

# Application Code

Do NOT modify application business logic.

Do NOT rewrite database, queue, Redis, or AI integrations.

Only make configuration changes necessary to run the existing application in Kubernetes.

If application code absolutely prevents Kubernetes configuration from working, document the issue first and prefer configuration-based solutions.

Do not introduce Kubernetes-specific application abstractions unnecessarily.

---

# Docker Images

Reuse the application's existing Dockerfiles.

Do not create duplicate Kubernetes-specific Dockerfiles unless absolutely necessary.

For kind, create a simple workflow such as:

```text
docker build
↓
kind load docker-image
↓
kubectl apply
```

Document the exact commands.

Do not introduce a remote container registry for this local experiment.

---

# PostgreSQL

If PostgreSQL currently runs locally as a container, run it locally inside Kubernetes.

Use:

* Deployment or StatefulSet only if justified
* Service
* PersistentVolumeClaim

Keep persistence simple.

The goal is to learn how Kubernetes handles storage, not to design production-grade database infrastructure.

Do not design PostgreSQL HA, replication, backups, operators, or clustering.

Later, a GKE deployment may use Cloud SQL instead of PostgreSQL running inside Kubernetes.

Keep that future migration possible by using configuration/environment variables cleanly.

---

# Redis

If Redis is required by the existing app, run it inside the local cluster.

Keep it simple:

* one instance
* Service
* basic configuration

Do not implement Redis clustering or high availability.

---

# RabbitMQ

If RabbitMQ is required, run a simple local RabbitMQ instance inside Kubernetes.

Expose it internally using a Kubernetes Service.

Do not build a RabbitMQ cluster.

Do not introduce operators.

---

# Workers and Jobs

Inspect how workers/background processes currently run.

If a worker is a long-running process, represent it as a Kubernetes Deployment.

If the application has actual scheduled/batch workloads, only translate them into Jobs/CronJobs if that accurately matches the current behavior.

Do not invent Kubernetes Jobs just for learning purposes.

Use the Kubernetes resource that correctly represents the existing workload.

---

# Configuration

Reuse the application's existing environment variables.

Separate portable configuration from local-specific values.

Use ConfigMaps for non-sensitive configuration.

Use Kubernetes Secrets for sensitive values.

Do not commit:

* database passwords
* OpenAI API keys
* JWT secrets
* OAuth secrets
* Redis passwords
* RabbitMQ passwords
* cloud credentials

Provide a documented local workflow for creating the required Secrets.

For example, prefer commands similar to:

```bash
kubectl create secret generic ...
```

or a safe untracked local file.

Do not commit actual secret values into Git.

---

# Cloud SQL Configuration

Inspect the application for existing Cloud SQL-specific database URLs or Unix socket configuration.

The local Kubernetes environment should use the local PostgreSQL Kubernetes Service instead.

Do not remove or break existing GCP/Cloud SQL configuration.

Use environment-specific configuration so that:

```text
local Kubernetes
      ↓
PostgreSQL Kubernetes Service
```

can later become:

```text
GKE
 ↓
Cloud SQL
```

without redesigning the application.

---

# Networking

Use Kubernetes Services for internal communication.

The API should communicate with PostgreSQL, Redis, RabbitMQ, and workers using Kubernetes service discovery where appropriate.

Do not use localhost for communication between separate pods.

Do not introduce Ingress yet.

For local access to the API, prefer:

```bash
kubectl port-forward
```

Example conceptually:

```bash
kubectl port-forward service/api 3000:3000
```

Adapt ports/names to the application.

---

# Health Checks

Inspect whether the application already exposes:

```text
/health/live
/health/ready
```

or equivalent endpoints.

If they exist, configure Kubernetes:

* livenessProbe
* readinessProbe

using them.

Do not modify application code just to create health endpoints as part of this task.

If the endpoints do not exist, document the limitation.

---

# Resource Requests and Limits

Add simple, conservative resource requests/limits where useful.

Do not spend significant effort tuning them.

The purpose is only to experience how Kubernetes represents resource requirements.

Avoid production capacity planning.

---

# Developer Experience

Make the workflow easy to repeat.

Provide commands or small scripts for:

## Create cluster

```bash
kind create cluster --name guitar-coach
```

Adapt the cluster name to the project if appropriate.

## Build images

Provide the actual Docker build commands based on the repository.

## Load images into kind

Example:

```bash
kind load docker-image <image> --name guitar-coach
```

## Deploy

```bash
kubectl apply -k k8s/overlays/local
```

## Inspect

```bash
kubectl get pods
kubectl get deployments
kubectl get services
kubectl get pvc
```

## Debug

```bash
kubectl describe pod <pod>
kubectl logs <pod>
kubectl logs -f <pod>
kubectl exec -it <pod> -- sh
```

## Access API

```bash
kubectl port-forward ...
```

## Restart workload

Show how to restart a Deployment.

## Delete resources

```bash
kubectl delete -k k8s/overlays/local
```

## Delete cluster

```bash
kind delete cluster --name guitar-coach
```

Adapt commands to the actual project.

---

# Documentation

Create:

```text
k8s/README.md
```

or another appropriate location.

Keep it concise but useful.

Document:

* prerequisites
* why kind was selected
* architecture
* base vs local overlay
* Docker image workflow
* Kubernetes deployment
* Secrets
* accessing the API
* database persistence
* debugging
* logs
* restarting pods
* deleting/recreating the environment
* common troubleshooting steps

Also explain the Kubernetes concepts used in the context of THIS application:

### Pod

The running instance of one of the application's containers.

### Deployment

Manages application pods such as API and workers.

### Service

Provides stable networking/DNS between workloads.

### ConfigMap

Stores non-secret environment configuration.

### Secret

Provides sensitive configuration.

### PersistentVolumeClaim

Provides persistent local database storage.

### Liveness Probe

Determines whether Kubernetes should restart an unhealthy container.

### Readiness Probe

Determines whether a pod should receive traffic.

### Kustomize Base

Contains portable Kubernetes application configuration.

### Local Overlay

Contains configuration specific to the local cluster.

---

# Architecture Diagram

Include a simple diagram based on the actual repository.

Conceptually:

```text
                    Local Machine
                         │
                  kubectl port-forward
                         │
                         ▼
                  ┌─────────────┐
                  │ Kubernetes  │
                  │    kind     │
                  └──────┬──────┘
                         │
                   API Deployment
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
      PostgreSQL       Redis        RabbitMQ
          ▲                             │
          │                             ▼
          └───────────────────────── Worker
```

Include other workloads only if they actually exist.

---

# Validation

After implementation, actually validate the setup locally where possible.

Verify:

1. kind cluster can be created.
2. Images can be built.
3. Images can be loaded into kind.
4. `kubectl apply -k k8s/overlays/local` succeeds.
5. Pods reach Running/Ready state.
6. PostgreSQL is accessible from the API.
7. Redis is accessible if required.
8. RabbitMQ is accessible if required.
9. Workers start successfully.
10. Kubernetes DNS/service discovery works.
11. API can be accessed through port forwarding.
12. At least one real database-backed API workflow succeeds.
13. Restarting an API pod does not break the environment.
14. PostgreSQL data survives a PostgreSQL pod restart if persistence is configured.
15. Resources and cluster can be cleanly destroyed.

Use:

```bash
kubectl get pods
kubectl describe
kubectl logs
```

to debug problems.

Fix Kubernetes configuration issues encountered during validation.

Do not modify application business logic simply to make validation pass.

---

# Keep This Deployable Later

This must be a learning environment, but not disposable Kubernetes configuration.

Make design choices that allow this future progression:

```text
Today

k8s/base/
        +
k8s/overlays/local/
        ↓
kind
```

Later:

```text
k8s/base/
        +
k8s/overlays/staging/
        ↓
GKE
```

The future staging/GKE overlay may replace:

```text
local PostgreSQL
local Redis
local RabbitMQ
```

with managed/cloud services where appropriate.

Do NOT implement any of those future integrations now.

Just ensure the base is not tightly coupled to kind or local infrastructure.

---

# Do Not Implement

Do NOT add:

* GKE
* GCP Kubernetes infrastructure
* Helm
* Terraform
* ArgoCD
* Flux
* GitOps
* Ingress controller
* external load balancer
* TLS/cert-manager
* HorizontalPodAutoscaler
* VerticalPodAutoscaler
* Kubernetes operators
* PostgreSQL operator
* RabbitMQ operator
* Redis clustering
* service mesh
* Istio
* Linkerd
* Prometheus stack
* Grafana stack
* production HA
* multi-zone architecture
* multi-cluster architecture

These can be separate exercises later.

---

# Implementation Philosophy

Keep this as:

**real Kubernetes, small architecture.**

Avoid both extremes:

```text
Toy:
one giant YAML file with everything hardcoded
```

and:

```text
Overengineered:
Helm + Terraform + ArgoCD + operators + service mesh + GKE
```

Aim for:

```text
Existing Dockerized Application
          ↓
Reusable Kubernetes Base
          +
Local Kustomize Overlay
          ↓
kind
```

This should be something that teaches real Kubernetes concepts and can evolve into a cloud deployment later.

---

# Definition of Done

When finished:

1. The entire existing containerized application runs locally on Kubernetes.
2. Application business logic has not been changed.
3. Kubernetes resources are organized using `base` + `overlays/local`.
4. Existing Dockerfiles are reused.
5. Internal communication uses Kubernetes Services/DNS.
6. Sensitive values are not committed.
7. PostgreSQL has basic persistence if appropriate.
8. Existing health endpoints are used as probes where available.
9. The API is accessible locally through port forwarding.
10. All real application workflow has been verified.
11. The environment can be created and destroyed repeatedly.
12. The reusable base is not coupled specifically to kind.
13. The README explains both how to use the environment and what Kubernetes concepts are being exercised.

At the end, provide a concise summary containing:

* files created/changed
* final Kubernetes architecture
* Kubernetes resources used
* commands to start everything
* commands to inspect/debug
* commands to shut everything down
* validation performed
* any limitations
* what would need to change later for GKE
* confirmation that no application business logic was modified

Keep the implementation minimal, reusable, and production-directional without turning this exercise into production Kubernetes engineering.
