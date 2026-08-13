// Small, configurable load test for the same practice-sessions
// create/list/get workflow as the smoke test. VUs/duration/thresholds are
// all env-var driven — see docs/performance-testing.md.
//
// Closed-loop model (constant-vus, no sleep/think-time): measures "how fast
// can N VUs round-trip this workflow," not a modeled arrival rate. Sufficient
// for a first, small load test; not a stress/spike/soak test.
import { VUS, DURATION, buildThresholds, SUMMARY_TREND_STATS } from './lib/config.js';
import { provisionSession } from './lib/auth.js';
import { runPracticeSessionWorkflow } from './lib/workflows.js';

export const options = {
  scenarios: {
    load: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: buildThresholds(),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export function setup() {
  return provisionSession();
}

export default function (data) {
  runPracticeSessionWorkflow(data.cookieHeader);
}
