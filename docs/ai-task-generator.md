# AI Task Generator

Admin-only. An admin describes what to practise and how many tasks they want; the model drafts
them; the admin chooses which ones to keep and creates them in one request. Nothing is saved by
the generator itself.

```bash
# 1. Draft — persists nothing, answers 200
curl -b cookies.txt -X POST http://localhost:3000/api/v1/ai/task-generator \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Improve my 7-string riffs: sections of famous riffs by Dream Theater, Trivium and Periphery","count":5}'
# => { "drafts": [ { "title": ..., "description": ..., "category": "repertoire",
#                    "difficulty": "hard", "referenceLink": "https://..." | null }, ... ] }

# 2. Create the chosen drafts — all or nothing, answers 201 with the created tasks
curl -b cookies.txt -X POST http://localhost:3000/api/v1/tasks/bulk \
  -H 'Content-Type: application/json' \
  -d '{"tasks":[{"title":"...","category":"repertoire","difficulty":"hard"}]}'
```

| Route                            | Who   | Body                                    | Notes                                       |
| -------------------------------- | ----- | --------------------------------------- | ------------------------------------------- |
| `POST /api/v1/ai/task-generator` | admin | `{ prompt: 1–2000 chars, count: 1–10 }` | Rate-limited with the other `/ai/*` routes  |
| `POST /api/v1/tasks/bulk`        | admin | `{ tasks: CreateTaskDto[1..10] }`       | One transaction; one invalid task fails all |

Notes:

- Runs through the same `AiProvider` / `OpenAiResponsesService` as the practice planner, with
  `web_search` and a structured output (`TaskDraftsSchema`). The model is told the shared
  library's titles (up to 200) so it avoids duplicates.
- Output is never trusted as-is (`normalizeTaskDrafts`): titles are trimmed and clipped to 200
  characters, drafts with titles under 2 characters are dropped, descriptions are clipped to 2000,
  a `referenceLink` that isn't http(s) becomes `null`, and extra drafts are cut to `count`. A
  reply with no usable drafts is a `502`.
- OpenAI timeouts and outages map to `504` / `503`, through the shared `callAiProvider`.
- Created tasks are shared library tasks (`ownerId` null), unlike the practice planner's private
  ones.
