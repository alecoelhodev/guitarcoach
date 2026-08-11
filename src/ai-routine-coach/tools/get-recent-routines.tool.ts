import { Logger } from '@nestjs/common';
import { tool } from '@openai/agents';
import { z } from 'zod';
import type { RoutinesService } from '../../routines/routines.service';
import type { RoutineWithTasks } from '../../routines/routines.service';
import { RoutineCoachContext } from '../agent/routine-coach.context';
import {
  DEFAULT_LOOKBACK_DAYS,
  MAX_LOOKBACK_DAYS,
  MIN_LOOKBACK_DAYS,
} from './tool-constants';
import { requireUserId } from './require-user-id';

const logger = new Logger('get_recent_routines');

export const GetRecentRoutinesArgsSchema = z.object({
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

export type GetRecentRoutinesArgs = z.infer<typeof GetRecentRoutinesArgsSchema>;

export interface RecentRoutineResult {
  id: string;
  title: string;
  createdAt: string;
  tasks: {
    taskId: string;
    title: string;
    position: number;
    targetDurationMinutes: number | null;
  }[];
}

function toResult(routine: RoutineWithTasks): RecentRoutineResult {
  return {
    id: routine.id,
    title: routine.title,
    createdAt: routine.createdAt.toISOString(),
    tasks: routine.routineTasks.map((routineTask) => ({
      taskId: routineTask.taskId,
      title: routineTask.task.title,
      position: routineTask.position,
      targetDurationMinutes: routineTask.targetDurationMinutes,
    })),
  };
}

export async function getRecentRoutines(
  deps: { routinesService: Pick<RoutinesService, 'findRecent'> },
  userId: string,
  args: GetRecentRoutinesArgs,
): Promise<RecentRoutineResult[]> {
  logger.debug('get_recent_routines invoked');
  const routines = await deps.routinesService.findRecent(
    userId,
    args.days ?? DEFAULT_LOOKBACK_DAYS,
  );
  return routines.map(toResult);
}

export function buildGetRecentRoutinesTool(deps: {
  routinesService: RoutinesService;
}) {
  return tool<typeof GetRecentRoutinesArgsSchema, RoutineCoachContext>({
    name: 'get_recent_routines',
    description:
      "Retrieve the authenticated user's recently created routines -- what " +
      'was planned, not necessarily what was actually practiced. Prefer ' +
      'get_recent_practice_sessions when deciding what the user has actually ' +
      'practiced recently.',
    parameters: GetRecentRoutinesArgsSchema,
    execute: (input, runContext) =>
      getRecentRoutines(deps, requireUserId(runContext), input),
  });
}
