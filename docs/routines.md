# Routines

Full endpoint walkthrough for the `routines` module — create/attach/reorder/delete curls and the reordering-lock behavior. See [README.md](../README.md) for the rest of the API.

A routine is a user-owned, ordered list of tasks pulled from the shared [task library](../README.md#data-model), each with an optional target duration. All routes below require a session cookie — see [Authentication](authentication.md) to sign in and obtain `cookies.txt` first. Routines and their tasks are scoped to the requesting user: acting on another user's routine returns `404 Not Found` (not `403`).

```bash
# Create a routine
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/routines \
  -H 'Content-Type: application/json' \
  -d '{"title":"Daily warm-up","notes":"15 minutes before practice"}'

# Attach a task to it (position/targetDurationMinutes are optional; position defaults to "next")
curl -i -b cookies.txt -X POST \
  http://localhost:3000/api/v1/routines/<routine-uuid>/tasks \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"<task-uuid>","targetDurationMinutes":10}'

# List a routine's tasks, in order
curl -i -b cookies.txt http://localhost:3000/api/v1/routines/<routine-uuid>/tasks

# Reorder tasks (must include every taskId currently in the routine, in the new order)
curl -i -b cookies.txt -X PATCH \
  http://localhost:3000/api/v1/routines/<routine-uuid>/tasks/reorder \
  -H 'Content-Type: application/json' \
  -d '{"taskIds":["<task-uuid-2>","<task-uuid-1>"]}'

# Remove a task from the routine
curl -i -b cookies.txt -X DELETE \
  http://localhost:3000/api/v1/routines/<routine-uuid>/tasks/<task-uuid>

# Delete the routine (409 if it still has tasks attached)
curl -i -b cookies.txt -X DELETE http://localhost:3000/api/v1/routines/<routine-uuid>
```

Reordering acquires a short-lived Redis distributed lock per routine (see [Architecture](../README.md#architecture)): a concurrent reorder request on the same routine fails fast with `409 Conflict` instead of queuing, and `503 Service Unavailable` if the lock can't be acquired at all. Creating a routine also publishes a `routine.created` event to RabbitMQ — this is fire-and-forget and never blocks or fails the request itself.
