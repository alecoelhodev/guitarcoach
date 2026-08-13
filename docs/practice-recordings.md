# Practice recordings

Full endpoint walkthrough for practice sessions and their audio recordings — credential setup, allowed content types, and curl examples. See [README.md](../README.md) for the rest of the API.

Authenticated users can upload audio recordings of their practice sessions. Files are stored privately in Google Cloud Storage; only metadata (file name, content type, size, object path) is kept in Postgres. Requires `GCP_PROJECT_ID` and `GCS_RECORDINGS_BUCKET` to be set (see [Environment variables](../README.md#environment-variables)).

**Credentials, local dev only** (production/Cloud Run uses the attached service account instead): `GOOGLE_APPLICATION_CREDENTIALS` must be a fully-qualified path — Node reads it literally, so `~/...` shortcuts are **not** expanded and fail with `ENOENT`. If running via Docker Compose ([Option A](../README.md#option-a--docker-compose)), the container also can't see that host path directly — set `GCP_CREDENTIALS_HOST_PATH` in `.env` to the same absolute host path; `compose.dev.yaml` bind-mounts it read-only into the container and points `GOOGLE_APPLICATION_CREDENTIALS` at the in-container path for you. See `.env.example` for both.

Allowed content types: `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/mp4`, `audio/x-m4a`, `audio/ogg`, `audio/webm`. Max upload size defaults to 50MB, configurable via `RECORDING_UPLOAD_MAX_SIZE_BYTES`.

All routes below require a session cookie — see [Authentication](authentication.md) to sign in and obtain `cookies.txt` first.

```bash
# Create a practice session to attach recordings to
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/practice-sessions \
  -H 'Content-Type: application/json' \
  -d '{"title":"Evening practice","notes":"Worked on barre chords"}'

# Same, but recording exactly which tasks were practiced and for how long,
# optionally against the routine that was followed -- this is what lets the
# AI Routine Coach (see below) tell what was actually practiced apart from
# what was merely planned
curl -i -b cookies.txt -X POST http://localhost:3000/api/v1/practice-sessions \
  -H 'Content-Type: application/json' \
  -d '{"routineId":"<routine-uuid>","tasks":[{"taskId":"<task-uuid>","durationMinutes":15,"completed":true}]}'

# Upload a recording to that session (multipart/form-data, field name "file")
curl -i -b cookies.txt -X POST \
  http://localhost:3000/api/v1/practice-sessions/<session-uuid>/recordings \
  -F 'file=@practice.mp3;type=audio/mpeg'

# List recordings for a session
curl -i -b cookies.txt http://localhost:3000/api/v1/practice-sessions/<session-uuid>/recordings

# Get a time-limited signed download URL for a recording
curl -i -b cookies.txt http://localhost:3000/api/v1/recordings/<recording-uuid>/download-url

# Delete a recording (removes both the GCS object and its metadata row)
curl -i -b cookies.txt -X DELETE http://localhost:3000/api/v1/recordings/<recording-uuid>
```

The download URL returned by `/recordings/:id/download-url` expires after `RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS` (default 900s / 15 minutes) — request a fresh one if it lapses.

Sessions and recordings are scoped to the requesting user: acting on another user's session or recording returns `404 Not Found` (not `403`), so existence isn't leaked to non-owners. A `routineId` supplied when creating a session is checked the same way — referencing a routine you don't own also returns `404`.
