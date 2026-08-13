# AI Routine Coach

No-confirmation AI routine agent — the five tools it can call, its input guardrail, and the request curl. See [README.md](../README.md) for the rest of the API.

Describe what you want ("create me a 45-minute routine based on what I haven't practiced recently") and a single `RoutineCoachAgent` — built on the [`@openai/agents`](https://github.com/openai/openai-agents-js) SDK, using its built-in tool-calling run loop rather than a hand-rolled one — decides for itself which of five typed tools it needs, gathers whatever context it thinks is relevant, and creates the routine directly. Unlike the [AI Practice Planner](ai-practice-planner.md), there's no confirmation step: a single `POST /api/v1/ai/routine-coach` call either returns a persisted routine or doesn't. Requires `OPENAI_API_KEY`/`OPENAI_MODEL` to be set (see [Environment variables](../README.md#environment-variables)).

```bash
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/ai/routine-coach \
  -H 'Content-Type: application/json' \
  -d '{"message":"Create a 45-minute guitar routine based on things I have not practiced recently. Avoid what I practiced yesterday."}'
# => { "message": "...", "routineId": "...", "routineTitle": "...", "taskCount": 4 }
```

The five tools, all resolving the authenticated user from SDK-native `RunContext` rather than any model-supplied argument:

| Tool | Purpose |
|---|---|
| `get_recent_practice_sessions` | What was **actually** practiced recently (per-task duration, completion) — the strongest signal for recent behavior |
| `get_recent_routines` | What was **planned** recently — weaker signal, useful for understanding intent |
| `get_user_tasks` | The task catalog routines can be built from; the model may only use task IDs this tool returns |
| `get_task_stats` | Deterministic, aggregated per-task stats (times/minutes practiced, last-practiced date) computed in application code, not left to the model to derive from raw session data |
| `create_routine` | The only tool that writes anything — persists through the existing `RoutinesService`/`TasksService`, after independently re-validating every task ID, duration, and ordering |

Notes:

- **The tool sequence is never hardcoded.** "Create a 30-minute routine for today" might resolve with just `get_user_tasks` + `create_routine`; a request that depends on recent history pulls in `get_recent_practice_sessions`/`get_task_stats` first. The agent decides.
- **A native input guardrail runs before the model is called at all** (`RoutineCoachInputGuardrail`, wired through `@openai/agents`' own `InputGuardrail` mechanism, blocking rather than running in parallel). It's a deliberately small heuristic keyword check — not a second LLM call, since the app is scoped to exactly one agent — that rejects requests unrelated to guitar practice/routines or attempting to reach credentials, secrets, SQL, or another user's data. A trip returns `400` without leaking guardrail internals or system instructions; it's logged server-side and never replaces the deterministic authorization below.
- **The LLM never touches Prisma, decides authorization, or is trusted about whether a write succeeded.** `create_routine`'s arguments (existing task IDs, a duration, and an order per task) are independently re-validated in application code — every task ID must exist, durations and the routine total must be within a fixed cap, orders must be exactly `1..N` with no gaps or duplicates — before `RoutinesService.create`/`addTask` are called. The response's `routineId` is read from a side-channel the tool sets only after that write actually succeeds, never parsed out of the model's own text, so the model claiming success and a routine actually existing can't drift apart.
- Max turns is capped (8) to bound runaway tool-calling loops; hitting the cap maps to `502`, same bucket as a malformed OpenAI response. Malformed tool-call arguments from the model map to `400`; an unhandled failure inside a tool (e.g. an unexpected database error while reading practice history) maps to `502` without leaking the underlying cause.
- `Task` has no per-user ownership in this schema (it's a shared, admin-managed catalog) — `get_user_tasks` returns the same catalog to every user; "task not found" is the only way an invalid task ID can fail.
