// Smoke test: one VU, one iteration through the practice-sessions
// create -> get -> list workflow. Fails fast on any functional or
// transport error — see docs/performance-testing.md.
import { buildThresholds, WORKFLOW_TAGS, SUMMARY_TREND_STATS } from './lib/config.js';
import { provisionSession } from './lib/auth.js';
import { runPracticeSessionWorkflow, cleanupPracticeSessions } from './lib/workflows.js';

// A smoke test's pass bar isn't something to tune via env var — the whole
// point is "does the happy path work at all." Scoped to the workflow tags
// only (not the blended http_req_failed), same reasoning as buildThresholds()
// in config.js: the auth setup() probe can expectedly 401 once, on a
// brand-new test user, before its sign-up fallback succeeds.
const hardWorkflowThresholds = {};
for (const name of WORKFLOW_TAGS) {
  hardWorkflowThresholds[`http_req_failed{name:${name}}`] = ['rate==0'];
}

export const options = {
  scenarios: {
    smoke: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    ...buildThresholds(),
    ...hardWorkflowThresholds,
    checks: ['rate==1'],
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export function setup() {
  return provisionSession();
}

export default function (data) {
  runPracticeSessionWorkflow(data.cookieHeader);
}

export function teardown(data) {
  cleanupPracticeSessions(data.cookieHeader);
}
