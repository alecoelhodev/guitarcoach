import { meters } from '../../observability/metrics/meters';

/**
 * Shared per-tool timing wrapper for the RoutineCoachAgent tool handlers --
 * records `ai_tool_duration_ms` (tool name + success/error outcome) without
 * touching a handler's `(deps, userId, args) => result` contract or altering
 * what it returns/throws. Metadata only: duration and outcome, never the
 * tool's arguments or result.
 */
export async function withToolDuration<T>(
  tool: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    meters.aiToolDurationMs.record(Date.now() - startedAt, {
      tool,
      outcome: 'success',
    });
    return result;
  } catch (error) {
    meters.aiToolDurationMs.record(Date.now() - startedAt, {
      tool,
      outcome: 'error',
    });
    throw error;
  }
}
