# Claude Prompt — Observability, Reliability & OWASP A09:2025

Improve the **Observability, Reliability, and Security** of this application, with special focus on:

**OWASP Top 10:2025 — A09: Security Logging and Alerting Failures**

Source of truth:

`https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/`

Use multiple specialized Claude coding agents to inspect, implement, test, and review the work.

Do not merely produce recommendations. **Implement the improvements where they belong in the existing architecture.**

## Before coding

Have an architecture/reconnaissance agent inspect the repository and identify:

* NestJS API architecture
* existing logger implementation
* global middleware/interceptors/filters
* error handling
* authentication and authorization
* PostgreSQL/Prisma
* Redis
* RabbitMQ / queues
* workers
* scheduled/background jobs
* OpenAI / `@openai/agents` integration
* deployment/runtime configuration
* GCP integration if applicable
* existing health checks
* metrics/tracing libraries
* current tests
* infrastructure/configuration related to monitoring or alerting

Reuse existing conventions and infrastructure whenever possible.

Do not introduce a large observability stack if the application already has an appropriate mechanism.

Do not expand scope into unrelated refactoring.

---

# 1. Structured Logging + Correlation IDs

Implement consistent **structured logging** across:

* HTTP API requests
* service operations where useful
* RabbitMQ producers/consumers
* workers
* scheduled jobs
* background jobs
* Redis-dependent operations where relevant
* AI agent executions
* AI tool calls
* external service calls

Prefer JSON-compatible structured fields instead of interpolated/free-form log strings.

Establish a common log context containing useful fields such as:

* `timestamp`
* `level`
* `service`
* `environment`
* `requestId`
* `correlationId`
* `traceId` if tracing exists
* `operation`
* `route`
* `method`
* `statusCode`
* `durationMs`
* `errorCode`
* job/queue identifiers where appropriate
* AI agent/tool identifiers where appropriate

Do not blindly log every field everywhere.

## Request IDs

Every incoming API request should have a request/correlation ID.

Behavior:

* accept a valid incoming request ID if the application intentionally supports this and it is safe to do so; otherwise generate one
* return the request ID in the response headers
* automatically include it in logs generated during that request
* propagate correlation context into asynchronous work

For flows like:

```text
HTTP Request
    ↓
API
    ↓
RabbitMQ
    ↓
Worker
    ↓
Database
    ↓
OpenAI Agent
    ↓
Agent Tool
```

make it possible to correlate the operation across the entire chain.

For jobs that do not originate from an HTTP request, generate an appropriate correlation/execution ID when the job begins.

Do not require developers to manually pass request IDs through every method if an existing safe context mechanism can handle this cleanly.

---

# 2. Queue and Worker Correlation

When publishing RabbitMQ messages/jobs, propagate relevant observability context using the established message metadata/header conventions.

At minimum preserve:

* correlation/request ID
* job/message ID
* originating operation when useful

Workers should restore this context before processing.

Structured worker logs should make it possible to understand:

```text
message received
→ processing started
→ dependencies called
→ processing succeeded/failed
→ retry/DLQ if applicable
```

Avoid logging entire queue payloads by default because they may contain sensitive information.

---

# 3. AI Observability

Instrument the existing OpenAI / `@openai/agents` functionality.

Capture useful metadata such as:

* agent name
* agent execution ID if available
* correlation/request ID
* model
* execution latency
* number of agent turns if available
* tool name
* tool execution latency
* tool success/failure
* input/output token usage when available
* total token usage
* estimated/provider-reported cost when reliably available
* guardrail triggered
* max-turn termination
* OpenAI/provider errors

Do NOT log raw prompts, model responses, complete conversation history, tool payloads, or tool results by default.

They may contain user data or sensitive information.

Prefer metadata and sanitized summaries.

Do not hardcode volatile AI pricing throughout application code.

If cost estimation is implemented, centralize the pricing/configuration or use provider-reported usage/cost data when available.

---

# 4. Sensitive Data Protection

Create or centralize a logging sanitization/redaction strategy.

Logs must not expose:

* passwords
* JWTs
* session tokens
* refresh tokens
* `Authorization` headers
* cookies
* API keys
* OpenAI keys
* database credentials
* database URLs containing credentials
* OAuth tokens
* Redis credentials
* RabbitMQ credentials
* secrets
* raw authentication headers
* unnecessarily sensitive user information

Inspect existing logging statements for accidental leakage.

Do not log full HTTP request/response bodies globally.

Where user identifiers are useful for security investigation, use the minimum identifier necessary and follow existing application privacy conventions.

Sanitize untrusted strings before they reach systems where they could cause log injection or break log structure.

---

# 5. Security Event Logging

Identify important security-relevant events and ensure they are logged consistently.

Include appropriate events such as:

* successful login where applicable
* failed login
* failed authorization / access control
* authentication token failures
* server-side validation failures when security relevant
* repeated unauthorized requests
* rate-limit events if rate limiting exists
* attempts to access resources belonging to another user
* suspicious or rejected AI requests where appropriate
* AI guardrail triggers
* unexpected privileged operations
* security-sensitive configuration failures

Capture:

* event type
* outcome
* relevant actor/user identifier when safe
* target resource/type when safe
* request/correlation ID
* timestamp
* source context available to the server

Do NOT expose these internal security details in API responses.

Avoid creating noisy logs that make useful events impossible to identify.

---

# 6. Error Normalization

Inspect existing exception/error handling and establish a consistent error model.

Prefer a centralized NestJS mechanism such as the project's existing global exception filter/interceptor pattern.

Client responses should contain safe information such as:

```json
{
  "statusCode": 500,
  "code": "INTERNAL_ERROR",
  "message": "An unexpected error occurred",
  "requestId": "..."
}
```

Internal logs may contain additional debugging context.

Do not expose to API clients:

* stack traces
* Prisma internals
* SQL
* database table details
* filesystem paths
* secrets
* provider credentials
* internal OpenAI errors containing sensitive data
* RabbitMQ internals unnecessarily
* Redis connection information

Normalize known application/domain errors into stable error codes.

Preserve enough internal diagnostic information to investigate failures.

Unknown errors should safely default to an internal error response.

---

# 7. Liveness and Readiness

Implement separate health endpoints following the application's conventions.

Conceptually:

```text
GET /health/live
GET /health/ready
```

## Liveness

Liveness should answer:

> Is this application process alive and capable of running?

Do not make liveness depend unnecessarily on external services, because a database outage should not automatically imply that the application process itself is dead.

## Readiness

Readiness should answer:

> Can this instance currently perform the critical work it is expected to perform?

Inspect the application's architecture and determine which dependencies are truly critical.

Potential dependencies include:

* PostgreSQL
* Redis
* RabbitMQ

Consider whether the OpenAI provider should affect overall application readiness.

If AI is only one feature of the application, an OpenAI outage probably should not mark the entire API as unready.

Make this decision from the actual architecture rather than blindly including every dependency.

Health checks must:

* have bounded timeouts
* fail quickly
* avoid expensive queries
* avoid modifying data
* avoid exposing credentials or internal infrastructure details

Return minimal public health information.

Log detailed dependency failures internally.

---

# 8. Metrics

Instrument meaningful operational metrics.

At minimum cover:

## HTTP/API

* request count
* request latency
* error rate
* status code distribution where useful

Make latency data suitable for understanding percentiles such as:

* p50
* p95
* p99

if supported by the chosen metrics backend.

## PostgreSQL

Use existing instrumentation if available.

Track relevant database failure/latency indicators without creating high-cardinality metrics.

## Redis

Track meaningful dependency failures/latency where practical.

## RabbitMQ / queues

Track or expose:

* queue depth/backlog
* messages processed
* processing latency
* consumer failures
* retries
* dead-lettered jobs/messages if applicable

## Jobs/workers

Track:

* jobs started
* jobs succeeded
* jobs failed
* job duration
* retries
* consecutive failures where useful

## AI

Track:

* AI request count
* AI latency
* AI error rate
* agent execution latency
* tool latency
* token usage
* cost or estimated cost where reliable
* guardrail triggers
* max-turn failures

Avoid metric labels with uncontrolled/high-cardinality values such as:

* arbitrary user IDs
* request IDs
* entire URLs with dynamic IDs
* prompts
* error stack traces

Request IDs belong in logs/traces, not metric dimensions.

---

# 9. Alerting

A09 is about **logging AND alerting**.

Do not consider the work complete simply because logs exist.

Inspect the existing deployment/monitoring setup and implement actionable alerts where the repository/infrastructure supports doing so.

At minimum define appropriate alert conditions for:

* elevated API error rate
* abnormal request latency
* application instance not ready
* database dependency failure
* Redis dependency failure if critical
* RabbitMQ dependency failure
* queue depth/backlog above an appropriate threshold
* worker/job failure spikes
* repeated job retries or DLQ growth
* unusual authentication failures if auth telemetry supports it
* unusual authorization failures / 403 spikes
* repeated security-event patterns where appropriate
* AI provider error spikes
* abnormal AI latency
* unexpectedly high AI consumption/cost if reliable cost data exists

Avoid arbitrary thresholds.

Base thresholds on current architecture/configuration where possible.

If production traffic baselines are unavailable, introduce clearly configurable starter thresholds and document the assumption.

Alerts should be actionable and avoid obvious alert fatigue.

---

# 10. Audit Trail

Identify operations in the current domain that deserve an audit trail because they mutate important state or represent security-sensitive actions.

Do not confuse:

```text
application/debug logs
```

with:

```text
security/audit events
```

Where an audit trail already exists, preserve and improve it.

Where one is needed, use the application's existing persistence/logging patterns.

Audit records should make it possible to understand:

```text
who
did what
to which resource
when
and whether it succeeded
```

without storing unnecessary sensitive payloads.

Do not build a large audit subsystem unless justified by the current application.

---

# 11. Log Integrity and Availability

Review how logs are emitted and collected in the application's deployment environment.

Prefer stdout/stderr structured logging for containerized workloads when consistent with the existing runtime/platform.

Ensure application behavior does not depend on a remote logging service being available.

Logging failures should not normally bring down business operations.

If the repository contains infrastructure configuration for centralized logging:

* ensure logs can be centrally collected
* restrict unnecessary access
* avoid exposing logs publicly
* preserve appropriate retention
* avoid easy modification/deletion where platform controls exist

Do not invent a new SIEM or observability vendor unless the existing architecture requires it.

---

# 12. Reliability Under Dependency Failures

Review behavior when critical dependencies fail.

Specifically consider:

```text
PostgreSQL unavailable
Redis unavailable
RabbitMQ unavailable
OpenAI unavailable
worker crashes
job execution fails
```

Ensure failures are:

* detected
* logged
* observable
* represented by metrics
* reflected in readiness when appropriate
* handled without leaking internal details

Preserve existing retry/backoff strategies where correct.

Do not add retries blindly.

Avoid retry storms.

Do not hide persistent failures behind infinite retries.

---

# 13. OWASP A09 Verification

Have a dedicated security/review agent compare the resulting implementation against:

**OWASP Top 10:2025 — A09 Security Logging and Alerting Failures**

Verify at least:

* important security events are logged
* successes and failures are captured where appropriate
* logs are structured and consumable
* events can be correlated
* logs do not leak sensitive information
* untrusted log data is handled safely
* important errors cannot occur silently
* security-relevant activity can be monitored
* alerts exist or are clearly defined
* alerts are actionable
* logs are not exposed to normal application users
* audit/security logs have appropriate protection
* operational failures can be detected and investigated

Do not claim full OWASP compliance merely because individual controls were added.

Report:

```text
Implemented
Partially implemented
Not applicable
Remaining gap
```

for each relevant A09 control.

---

# Multi-Agent Execution

Use multiple Claude coding agents where work can safely happen in parallel.

Suggested responsibilities:

### Architecture / Recon Agent

Inspect the codebase and establish the existing patterns and proposed integration points.

### Observability Agent

Implement:

* structured logging
* correlation IDs
* propagation
* metrics
* AI observability
* queue/job observability

### Reliability Agent

Implement:

* liveness
* readiness
* dependency checks
* failure behavior
* job/worker reliability instrumentation

### Security Agent

Implement/review:

* log redaction
* sensitive-data leakage prevention
* security events
* normalized errors
* audit logging
* OWASP A09 requirements

### Testing Agent

Add tests for the new behavior.

### Final Review Agent

Review the complete diff against:

* this specification
* existing architecture
* OWASP A09:2025

Agents should share findings before introducing conflicting abstractions.

Prefer one coherent logging/observability approach across the application.

---

# Tests

Add meaningful tests for at least:

* request ID generation
* request ID propagation
* request ID returned to clients
* correlation across async work where testable
* sensitive-field redaction
* normalized error responses
* stack traces not exposed
* known vs unknown exception handling
* liveness
* readiness when dependencies are healthy
* readiness when critical dependencies fail
* structured logging behavior
* queue/job instrumentation where practical
* AI instrumentation where practical
* security event logging where practical

Do not require live PostgreSQL, Redis, RabbitMQ, OpenAI, or external monitoring systems in ordinary unit tests unless the repository already follows that integration-testing pattern.

---

# Constraints

* Inspect before editing.
* Follow existing NestJS conventions.
* Reuse existing abstractions.
* Do not introduce unnecessary libraries.
* Do not rewrite unrelated modules.
* Do not log entire HTTP payloads globally.
* Do not log secrets.
* Do not expose internal health details publicly.
* Do not hardcode production alert thresholds without documenting them.
* Avoid high-cardinality metric labels.
* Do not make OpenAI availability block the entire application unless architecture truly requires it.
* Do not create a new observability vendor dependency without strong justification.
* Keep the implementation production-oriented but proportionate to this application's size.

---

# Definition of Done

When implementation is complete:

1. Run formatting.
2. Run linting.
3. Run TypeScript type checking.
4. Run unit/integration tests relevant to the changes.
5. Fix issues introduced by the implementation.
6. Have the security agent perform an OWASP A09:2025 review.
7. Have a final review agent inspect the complete diff.

Then provide a concise final report containing:

### Architecture

Show the final observability flow, for example:

```text
Request
  ↓ correlationId
API
  ↓
Service
  ├── PostgreSQL
  ├── Redis
  ├── RabbitMQ → Worker/Job
  └── RoutineCoachAgent → OpenAI / Agent Tools

Structured Logs + Metrics + Traces
                ↓
        Monitoring / Alerting
```

### Changes

List the important files/components changed.

### Signals Available

List the implemented:

* logs
* metrics
* health checks
* security events
* alerts
* AI observability

### Failure Behavior

Explain what happens when:

* PostgreSQL fails
* Redis fails
* RabbitMQ fails
* OpenAI fails
* a worker/job fails

### Security

Explain:

* sensitive-data redaction
* normalized error handling
* security-event logging
* audit behavior

### OWASP A09 Matrix

For each applicable requirement:

```text
Control | Status | Evidence | Remaining Gap
```

### Validation

Report the actual results of:

* format
* lint
* typecheck
* tests

Do not mark something complete unless it was actually implemented and verified.
