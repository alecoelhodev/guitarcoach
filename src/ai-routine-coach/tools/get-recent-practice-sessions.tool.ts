import { Logger } from '@nestjs/common';
import { tool } from '@openai/agents';
import { z } from 'zod';
import type {
  PracticeSessionWithTasks,
  PracticeSessionsService,
} from '../../practice-sessions/practice-sessions.service';
import { RoutineCoachContext } from '../agent/routine-coach.context';
import {
  DEFAULT_LOOKBACK_DAYS,
  MAX_LOOKBACK_DAYS,
  MIN_LOOKBACK_DAYS,
} from './tool-constants';
import { requireUserId } from './require-user-id';
import { withToolDuration } from './tool-observability';

const logger = new Logger('get_recent_practice_sessions');

export const GetRecentPracticeSessionsArgsSchema = z.object({
  days: z
    .number()
    .int()
    .min(MIN_LOOKBACK_DAYS)
    .max(MAX_LOOKBACK_DAYS)
    .optional()
    .describe(
      `How many days back to look. Defaults to ${DEFAULT_LOOKBACK_DAYS} if omitted.`,
    ),
});

export type GetRecentPracticeSessionsArgs = z.infer<
  typeof GetRecentPracticeSessionsArgsSchema
>;

export interface RecentPracticeSessionResult {
  date: string;
  durationMinutes: number;
  routineId: string | null;
  routineTitle: string | null;
  tasks: {
    taskId: string;
    title: string;
    durationMinutes: number | null;
    completed: boolean;
  }[];
}

function toResult(
  session: PracticeSessionWithTasks,
): RecentPracticeSessionResult {
  const tasks = session.sessionTasks.map((sessionTask) => ({
    taskId: sessionTask.taskId,
    title: sessionTask.task.title,
    durationMinutes: sessionTask.durationMinutes,
    completed: sessionTask.completed,
  }));

  return {
    date: session.createdAt.toISOString(),
    durationMinutes: tasks.reduce(
      (sum, task) => sum + (task.durationMinutes ?? 0),
      0,
    ),
    routineId: session.routine?.id ?? null,
    routineTitle: session.routine?.title ?? null,
    tasks,
  };
}

export async function getRecentPracticeSessions(
  deps: {
    practiceSessionsService: Pick<PracticeSessionsService, 'findRecent'>;
  },
  userId: string,
  args: GetRecentPracticeSessionsArgs,
): Promise<RecentPracticeSessionResult[]> {
  return withToolDuration('get_recent_practice_sessions', async () => {
    logger.debug('get_recent_practice_sessions invoked');
    const sessions = await deps.practiceSessionsService.findRecent(
      userId,
      args.days ?? DEFAULT_LOOKBACK_DAYS,
    );
    return sessions.map(toResult);
  });
}

export function buildGetRecentPracticeSessionsTool(deps: {
  practiceSessionsService: PracticeSessionsService;
}) {
  return tool<typeof GetRecentPracticeSessionsArgsSchema, RoutineCoachContext>({
    name: 'get_recent_practice_sessions',
    description:
      "Retrieve the authenticated user's actual recent practice sessions " +
      '(what was really practiced, with per-task durations and completion), ' +
      'as opposed to what was planned in a routine. This is the strongest ' +
      "signal for the user's recent practice behavior.",
    parameters: GetRecentPracticeSessionsArgsSchema,
    execute: (input, runContext) =>
      getRecentPracticeSessions(deps, requireUserId(runContext), input),
  });
}
