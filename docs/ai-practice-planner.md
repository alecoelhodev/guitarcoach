# AI Practice Planner

Confirmation-gated AI routine planner — request/confirm/decline curls and validation notes. See [README.md](../README.md) for the rest of the API.

Describe the routine you want in plain language and get back a structured plan via the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) — nothing is saved until you explicitly confirm it. A single endpoint, `POST /api/v1/ai/practice-planner`, handles both steps of the exchange. Requires `OPENAI_API_KEY`/`OPENAI_MODEL` to be set (see [Environment variables](../README.md#environment-variables)).

```bash
# 1. Ask for a plan — returns a structured plan and a previousResponseId, nothing is persisted yet
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/ai/practice-planner \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Create me a 30-minute blues routine focused on bending and improvisation."}'
# => { "status": "awaiting_confirmation", "plan": { "title": ..., "tasks": [...] }, "previousResponseId": "resp_..." }

# 2a. Confirm — persists the routine and its tasks through the existing routines/tasks services
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/ai/practice-planner \
  -H 'Content-Type: application/json' \
  -d '{"confirmation":true,"previousResponseId":"resp_..."}'
# => { "status": "created", "routine": { "routineId": "...", "title": "...", "taskCount": 3 } }

# 2b. Decline — persists nothing at all
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/ai/practice-planner \
  -H 'Content-Type: application/json' \
  -d '{"confirmation":false,"previousResponseId":"resp_..."}'
# => { "status": "cancelled" }
```

Notes:

- The authenticated user ID always comes from the session cookie, never from the request body — the model has no way to supply or override it. Confirming a `previousResponseId` that isn't yours (or has expired) returns `404 Not Found`, same non-leaking convention as every other user-scoped resource.
- OpenAI's built-in `web_search` tool is available to the model but optional — it's only used when the model decides external information would improve the plan, not on every request.
- The plan is validated twice before anything is written: once by the Responses API's Structured Outputs schema, and again by application code (at least one task, positive durations, task durations reasonably summing to the requested total) — model output is never trusted blindly.
- OpenAI timeouts/outages map to `504`/`503` and never affect any other endpoint; a malformed or unexpected model response maps to `502`.
