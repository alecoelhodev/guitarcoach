Extend the existing AI Practice Planner feature by adding a new custom tool named `create_calendar_event`.

## Goal

After the user confirms an AI-generated routine and the routine is successfully created, allow the AI workflow to also add that routine to the user's Google Calendar.

Example user request:

"Create me a 30-minute blues routine for Friday at 6 PM and add it to my calendar."

## Phase 1 — Inspect first

Before changing code:

1. Inspect the existing AI Practice Planner implementation.
2. Review:
   - Responses API integration
   - current custom-tool dispatcher
   - `create_routine` tool
   - confirmation flow
   - authentication/user context
   - configuration patterns
   - tests
3. Inspect whether any Google Calendar or OAuth integration already exists.
4. Produce a concise execution plan.
5. Reuse existing abstractions and conventions where possible.

Do not rewrite the existing AI Practice Planner architecture.

## New custom tool

Add:

`create_calendar_event`

Suggested tool input:

{
  "title": "Friday Blues Practice",
  "startAt": "2026-08-14T18:00:00-04:00",
  "durationMinutes": 30,
  "description": "AI-generated guitar practice routine",
  "routineId": "routine-uuid"
}

The model must not provide:

- userId
- OAuth access tokens
- refresh tokens
- calendar credentials

The authenticated user must be resolved by the application.

## Calendar integration

Create a small calendar abstraction, for example:

CalendarService
  |
  └── GoogleCalendarService
          |
          └── Google Calendar API

Do not call the Google Calendar SDK directly from the AI tool handler.

The service should expose something equivalent to:

createEvent({
  userId,
  title,
  startAt,
  durationMinutes,
  description,
  routineId
})

Use the official Google Calendar API / SDK.

## OAuth setup

Before implementing the Calendar API integration, guide me through the required Google Cloud configuration.

Provide a concise checklist covering:

- enabling Google Calendar API
- configuring OAuth consent
- creating OAuth client credentials
- required scopes
- redirect URI configuration
- local-development setup
- environment variables
- securely storing refresh/access tokens
- production recommendations

Follow least privilege.

Do not recommend storing OAuth tokens in source control.

Pause after the Google setup instructions and wait for my confirmation before implementing code that depends on those credentials.

## AI workflow

Preserve the existing confirmation flow.

Expected sequence:

1. User requests a routine and optional calendar schedule.
2. AI generates the structured routine.
3. User confirms.
4. `create_routine` executes.
5. Only after the routine succeeds, call `create_calendar_event` when the user requested calendar scheduling.
6. Return the final result containing both routine and calendar-event information.

Example:

{
  "status": "completed",
  "routine": {
    "id": "routine-uuid",
    "title": "Friday Blues Practice"
  },
  "calendarEvent": {
    "id": "calendar-event-id",
    "startAt": "2026-08-14T18:00:00-04:00"
  }
}

Do not create the calendar event before the routine is successfully persisted.

## Partial failure

Handle this case explicitly:

Routine created successfully
Calendar creation fails

Do not automatically delete the routine.

Return a partial-success result such as:

{
  "status": "partial_success",
  "routineCreated": true,
  "calendarEventCreated": false
}

Log the failure without exposing credentials or OAuth tokens.

## Date and timezone handling

- Require an explicit or resolvable start date/time before calling the tool.
- Use ISO-8601 timestamps.
- Preserve the user's timezone when known.
- Do not invent a timezone.
- If the user's requested time is ambiguous and cannot be resolved from existing context, ask for clarification before creating the event.

## Tool safety

- Validate all tool arguments server-side.
- Enforce reasonable duration limits.
- Sanitize title and description.
- Ensure the authenticated user owns the created routine.
- Do not allow arbitrary calendar IDs unless explicitly supported.
- Default to the authenticated user's primary calendar.

## Tests

Add focused tests covering:

1. `create_calendar_event` is registered as an OpenAI custom tool.
2. The authenticated user ID is injected server-side.
3. Calendar credentials are never accepted from the model.
4. Calendar event creation happens only after routine creation succeeds.
5. Calendar creation is skipped when the user did not request it.
6. Invalid dates or durations are rejected.
7. Google Calendar failure returns partial success without deleting the routine.
8. CalendarService is mocked in unit tests.
9. Existing AI Practice Planner behavior still works.

## Parallelization

After repository inspection and shared contracts are defined, parallelize only independent work.

Suggested workstreams:

### Workstream 1 — Google Calendar integration
- Calendar abstraction
- GoogleCalendarService
- OAuth/token handling
- configuration
- focused tests

### Workstream 2 — AI tool integration
- `create_calendar_event` tool schema
- tool dispatcher integration
- routine → calendar orchestration
- partial-failure handling

### Workstream 3 — Tests and validation
- workflow tests
- tool-validation tests
- regression tests for existing planner behavior

Assign clear file ownership and avoid concurrent edits to the same files.

## Out of scope

Do not add:

- MCP
- Gmail
- recurring calendar events
- calendar availability search
- frontend work
- automatic routine rollback
- generic Google API abstraction
- unrelated refactors

## Verification

After implementation:

1. Run formatting.
2. Run linting.
3. Run build/type checking.
4. Run relevant tests.
5. Test:
   "Create me a 30-minute blues routine for Friday at 6 PM and add it to my calendar."
6. Verify the routine is created.
7. Verify exactly one calendar event is created.
8. Verify the event duration and start time are correct.
9. Test Calendar API failure and confirm the routine remains created.
10. Confirm existing non-calendar AI Practice Planner requests still work.

At completion, report:

- files changed
- final tool schema
- calendar abstraction
- OAuth/configuration approach
- workflow changes
- partial-failure behavior
- tests executed
- known limitations
- deviations from this specification