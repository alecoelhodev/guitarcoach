import { Logger } from '@nestjs/common';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { Task, TaskCategory } from '../../generated/prisma/client';
import type { TasksService } from '../../tasks/tasks.service';
import { RoutineCoachContext } from '../agent/routine-coach.context';
import { requireUserId } from './require-user-id';

const logger = new Logger('get_user_tasks');

// Task is a global, admin-managed catalog shared by all users -- there is no
// per-user ownership in the schema, so this tool intentionally returns the
// full catalog regardless of which user is asking (userId is still resolved
// from RunContext for consistency with every other tool, and to keep the
// door open if per-user task ownership is ever introduced).
export const GetUserTasksArgsSchema = z.object({
  category: z
    .enum(['technique', 'theory', 'repertoire'])
    .optional()
    .describe('Optionally filter to a single task category.'),
});

export type GetUserTasksArgs = z.infer<typeof GetUserTasksArgsSchema>;

export interface UserTaskResult {
  id: string;
  title: string;
  category: TaskCategory | null;
  difficulty: Task['difficulty'] | null;
  description: string | null;
}

function toResult(task: Task): UserTaskResult {
  return {
    id: task.id,
    title: task.title,
    category: task.category ?? null,
    difficulty: task.difficulty ?? null,
    description: task.description ?? null,
  };
}

export async function getUserTasks(
  deps: { tasksService: Pick<TasksService, 'findAllUnpaginated'> },
  _userId: string,
  args: GetUserTasksArgs,
): Promise<UserTaskResult[]> {
  logger.debug('get_user_tasks invoked');
  const tasks = await deps.tasksService.findAllUnpaginated();
  const filtered = args.category
    ? tasks.filter((task) => task.category === args.category)
    : tasks;
  return filtered.map(toResult);
}

export function buildGetUserTasksTool(deps: { tasksService: TasksService }) {
  return tool<typeof GetUserTasksArgsSchema, RoutineCoachContext>({
    name: 'get_user_tasks',
    description:
      'Retrieve the practice task catalog available to build a routine from. ' +
      'Only task IDs returned by this tool may be used in create_routine -- ' +
      'never invent a task ID.',
    parameters: GetUserTasksArgsSchema,
    execute: (input, runContext) =>
      getUserTasks(deps, requireUserId(runContext), input),
  });
}
