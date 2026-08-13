// Shared env-var parsing, safety guard, and threshold/summary config for the
// practice-sessions k6 scripts. No HTTP calls here — pure init-time setup.

function assertSafeTarget(baseUrl) {
  const allowNonLocal = ['1', 'true', 'yes'].includes(String(__ENV.K6_ALLOW_NON_LOCAL || '').toLowerCase());
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(baseUrl);
  if (!isLocal && !allowNonLocal) {
    throw new Error(
      `Refusing to run k6 tests against non-local BASE_URL "${baseUrl}". ` +
        'Defaults to localhost-only so this never accidentally hits a shared or ' +
        'production environment. Set K6_ALLOW_NON_LOCAL=true if you really intend ' +
        `to target "${baseUrl}".`,
    );
  }
}

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
assertSafeTarget(BASE_URL);

export const API_BASE = `${BASE_URL}/api/v1`;
export const AUTH_BASE = `${BASE_URL}/auth`;

const missingCredentialVars = ['K6_TEST_USER_EMAIL', 'K6_TEST_USER_PASSWORD'].filter((name) => !__ENV[name]);
if (missingCredentialVars.length > 0) {
  throw new Error(
    `Missing required env var(s): ${missingCredentialVars.join(', ')}. ` +
      'Test credentials are never hardcoded in these scripts — set both ' +
      'K6_TEST_USER_EMAIL and K6_TEST_USER_PASSWORD before running (see docs/performance-testing.md).',
  );
}

export const TEST_USER_EMAIL = __ENV.K6_TEST_USER_EMAIL;
export const TEST_USER_PASSWORD = __ENV.K6_TEST_USER_PASSWORD;
export const TEST_USER_NAME = __ENV.K6_TEST_USER_NAME || 'k6 Perf Test User';

// Deliberately NOT named K6_VUS/K6_DURATION: those are k6's own reserved
// env-var equivalents of the --vus/--duration CLI flags, and setting them
// silently discards this script's named `load` scenario in favor of k6's
// implicit default one (confirmed via the "env level configuration
// overrode scenarios configuration entirely" warning during local testing).
export const VUS = Number(__ENV.K6_LOAD_VUS || 5);
export const DURATION = __ENV.K6_LOAD_DURATION || '30s';

export const ERROR_RATE = Number(__ENV.K6_THRESHOLD_ERROR_RATE || 0.01);
export const P95_MS = Number(__ENV.K6_THRESHOLD_P95_MS || 500);
export const P99_MS = Number(__ENV.K6_THRESHOLD_P99_MS || 1000);

export const SUMMARY_TREND_STATS = ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

// The practice-sessions workflow tags applied in lib/workflows.js — used to
// build both the default (configurable) thresholds here and the smoke
// script's hard overrides, so the two never drift out of sync.
export const WORKFLOW_TAGS = ['create', 'list', 'get'];

// `med` is p50. Thresholds are scoped to the workflow tags only, never the
// blended/untagged http_req_failed or http_req_duration — setup()'s sign-in
// probe (which is *expected* to 401 on a brand-new test user, before falling
// back to sign-up) is a one-time, handled auth outcome, not a
// practice-sessions error, and would otherwise wrongly count against these
// thresholds on the very first run against a fresh test identity.
export function buildThresholds() {
  const durationThresholds = [`p(95)<${P95_MS}`, `p(99)<${P99_MS}`];
  const failureThreshold = [`rate<${ERROR_RATE}`];
  const thresholds = { checks: [`rate>${1 - ERROR_RATE}`] };
  for (const name of WORKFLOW_TAGS) {
    thresholds[`http_req_duration{name:${name}}`] = durationThresholds;
    thresholds[`http_req_failed{name:${name}}`] = failureThreshold;
  }
  return thresholds;
}
