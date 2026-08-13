import http from 'k6/http';
import { check } from 'k6';
import { API_BASE } from './config.js';

// Fixed literal so a single exact-match filter (see cleanupPracticeSessions
// below) can find and remove everything a run created, without touching any
// other data. Shared, not duplicated, between create and cleanup.
export const WORKFLOW_TITLE = 'k6 practice session';

function jsonHeaders(cookieHeader) {
  return { 'Content-Type': 'application/json', Cookie: cookieHeader };
}

function parseBody(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

export function createPracticeSession(cookieHeader) {
  const res = http.post(
    `${API_BASE}/practice-sessions`,
    JSON.stringify({ title: WORKFLOW_TITLE }),
    { headers: jsonHeaders(cookieHeader), tags: { name: 'create' } },
  );
  const body = parseBody(res);
  check(res, {
    'create: status 201': (r) => r.status === 201,
    'create: has id': () => typeof body?.id === 'string',
  });
  return body;
}

export function listPracticeSessions(cookieHeader) {
  const res = http.get(`${API_BASE}/practice-sessions`, {
    headers: { Cookie: cookieHeader },
    tags: { name: 'list' },
  });
  // Deliberately not scanning array contents here: parsing/inspecting a
  // growing, unpaginated list on every iteration would distort the very
  // `list` latency this workflow is measuring over a longer run.
  const body = parseBody(res);
  check(res, {
    'list: status 200': (r) => r.status === 200,
    'list: is array': () => Array.isArray(body),
  });
  return body;
}

export function getPracticeSession(cookieHeader, sessionId) {
  const res = http.get(`${API_BASE}/practice-sessions/${sessionId}`, {
    headers: { Cookie: cookieHeader },
    // Literal tag, never the UUID — tagging per-request would fragment
    // metrics into one bucket per session id.
    tags: { name: 'get' },
  });
  const body = parseBody(res);
  check(res, {
    'get: status 200': (r) => r.status === 200,
    'get: id matches': () => body?.id === sessionId,
  });
  return body;
}

export function runPracticeSessionWorkflow(cookieHeader) {
  const created = createPracticeSession(cookieHeader);
  if (created?.id) {
    getPracticeSession(cookieHeader, created.id);
  }
  listPracticeSessions(cookieHeader);
}

// Called once from teardown() (see practice-sessions-smoke.js/-load.js), not
// per-iteration -- deleting immediately after each create would erase the
// "list keeps growing over the run" behavior these tests are meant to
// exercise. Best-effort: a cleanup hiccup shouldn't flip an otherwise-
// successful run to failed, so this has no check()/threshold tie-in and
// only logs a warning on failure.
export function cleanupPracticeSessions(cookieHeader) {
  const res = http.del(
    `${API_BASE}/practice-sessions?title=${encodeURIComponent(WORKFLOW_TITLE)}`,
    null,
    { headers: { Cookie: cookieHeader }, tags: { name: 'cleanup' } },
  );
  if (res.status !== 200) {
    console.warn(`teardown cleanup returned ${res.status}: ${res.body}`);
  }
}
