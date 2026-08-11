import { Logger } from '@nestjs/common';
import { tool } from '@openai/agents';
import { z } from 'zod';
import type { PracticeSessionsService } from '../../practice-sessions/practice-sessions.service';
import { RoutineCoachContext } from '../agent/routine-coach.context';
import {
  DEFAULT_LOOKBACK_DAYS,
  MAX_LOOKBACK_DAYS,
  MIN_LOOKBACK_DAYS,
} from './tool-constants';
import { requireUserId } from './require-user-id';

const logger = new Logger('get_task_stats');

export const GetTaskStatsArgsSchema = z.object({
  days: z
    .number()
    .int()
    .min(MIN_LOOKBACK_DAYS)
    .max(MAX_LOOKBACK_DAYS)
    .optional()
    .describe(
      `How many days back counts as "recent". Defaults to ${DEFAULT_LOOKBACK_DAYS} if omitted. ` +
        'lastPracticedAt and timesPracticedAllTime are not limited to this ' +
        'window -- a task with no lastPracticedAt has never been practiced.',
    ),
});

export type GetTaskStatsArgs = z.infer<typeof GetTaskStatsArgsSchema>;

export async function getTaskStats(
  deps: {
    practiceSessionsService: Pick<PracticeSessionsService, 'getTaskStats'>;
  },
  userId: string,
  args: GetTaskStatsArgs,
) {
  logger.debug('get_task_stats invoked');
  return deps.practiceSessionsService.getTaskStats(
    userId,
    args.days ?? DEFAULT_LOOKBACK_DAYS,
  );
}

export function buildGetTaskStatsTool(deps: {
  practiceSessionsService: PracticeSessionsService;
}) {
  return tool<typeof GetTaskStatsArgsSchema, RoutineCoachContext>({
    name: 'get_task_stats',
    description:
      'Get deterministic, aggregated per-task practice statistics for the ' +
      'authenticated user (times practiced, total minutes, last practiced ' +
      'date), computed from actual practice sessions. A task with no ' +
      'lastPracticedAt has never been practiced. Use this instead of trying ' +
      'to derive statistics yourself from raw session data.',
    parameters: GetTaskStatsArgsSchema,
    execute: (input, runContext) =>
      getTaskStats(deps, requireUserId(runContext), input),
  });
}
