import { Logger } from '@nestjs/common';
import { tool } from '@openai/agents';
import { z } from 'zod';
import type { RoutinesService } from '../../routines/routines.service';
import type { TasksService } from '../../tasks/tasks.service';
import { RoutineCoachContext } from '../agent/routine-coach.context';
import { isKnownToolError } from './known-tool-error';
import { requireUserId } from './require-user-id';
import {
  MAX_TASK_DURATION_MINUTES,
  MAX_TASKS_PER_ROUTINE,
  MAX_TOTAL_ROUTINE_DURATION_MINUTES,
} from './tool-constants';
import { withToolDuration } from './tool-observability';

const logger = new Logger('CreateRoutineTool');

// Deliberately has no `userId` field: the authenticated user is always
// resolved from RunContext by requireUserId(), never accepted from the
// model. Durations/task-count are bounded here since RoutinesService itself
// enforces no upper limit -- these are the "application limits" the spec
// requires deterministic code (not the LLM) to hold the line on.
export const CreateRoutineTaskArgSchema = z.object({
  taskId: z.string().uuid(),
  durationMinutes: z.number().int().min(1).max(MAX_TASK_DURATION_MINUTES),
  order: z.number().int().min(1),
});

export const CreateRoutineArgsSchema = z.object({
  name: z.string().min(2).max(200),
  tasks: z.array(CreateRoutineTaskArgSchema).min(1).max(MAX_TASKS_PER_ROUTINE),
});

export type CreateRoutineArgs = z.infer<typeof CreateRoutineArgsSchema>;

export type CreateRoutineResult =
  | { success: true; routineId: string; title: string; taskCount: number }
  | { success: false; error: string };

interface CreateRoutineDeps {
  routinesService: Pick<RoutinesService, 'create' | 'addTask'>;
  tasksService: Pick<TasksService, 'findById'>;
}

export async function createRoutine(
  deps: CreateRoutineDeps,
  userId: string,
  rawArgs: unknown,
  context: RoutineCoachContext,
): Promise<CreateRoutineResult> {
  return withToolDuration('create_routine', async () => {
    logger.debug('create_routine invoked');

    // Re-validate independently -- don't assume the SDK's upstream schema
    // validation held by the time this function is invoked (mirrors the
    // sibling CreateRoutineTool in ai-practice-planner).
    const parsed = CreateRoutineArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return { success: false, error: parsed.error.message };
    }
    const args = parsed.data;

    const taskIds = args.tasks.map((task) => task.taskId);
    if (new Set(taskIds).size !== taskIds.length) {
      return {
        success: false,
        error: 'Duplicate taskId in create_routine tasks',
      };
    }

    const orders = args.tasks.map((task) => task.order).sort((a, b) => a - b);
    const isContiguousFromOne = orders.every(
      (order, index) => order === index + 1,
    );
    if (!isContiguousFromOne) {
      return {
        success: false,
        error:
          'Task order values must be exactly 1..N with no gaps or duplicates',
      };
    }

    const totalDuration = args.tasks.reduce(
      (sum, task) => sum + task.durationMinutes,
      0,
    );
    if (totalDuration > MAX_TOTAL_ROUTINE_DURATION_MINUTES) {
      return {
        success: false,
        error: `Total routine duration (${totalDuration}m) exceeds the maximum of ${MAX_TOTAL_ROUTINE_DURATION_MINUTES}m`,
      };
    }

    const orderedTasks = [...args.tasks].sort((a, b) => a.order - b.order);

    try {
      // Validate every task exists BEFORE any write -- narrows (does not
      // eliminate) the partial-write window that the sequential addTask loop
      // below is exposed to.
      for (const taskId of new Set(taskIds)) {
        await deps.tasksService.findById(taskId);
      }

      const routine = await deps.routinesService.create(userId, {
        title: args.name,
      });

      // Sequential, not Promise.all: position must be assigned deterministically
      // in the requested order.
      for (const task of orderedTasks) {
        await deps.routinesService.addTask(userId, routine.id, {
          taskId: task.taskId,
          position: task.order,
          targetDurationMinutes: task.durationMinutes,
        });
      }

      context.createdRoutine = {
        routineId: routine.id,
        title: routine.title,
        taskCount: orderedTasks.length,
      };
      logger.log(`Routine successfully persisted (routineId=${routine.id})`);

      return {
        success: true,
        routineId: routine.id,
        title: routine.title,
        taskCount: orderedTasks.length,
      };
    } catch (error) {
      if (isKnownToolError(error)) {
        logger.warn(`create_routine rejected: ${error.message}`);
        return { success: false, error: error.message };
      }
      throw error;
    }
  });
}

export function buildCreateRoutineTool(deps: CreateRoutineDeps) {
  return tool<typeof CreateRoutineArgsSchema, RoutineCoachContext>({
    name: 'create_routine',
    description:
      'Persist a new practice routine for the authenticated user, made up ' +
      'of existing tasks (from get_user_tasks) with a duration and order ' +
      'for each. Only call this once you have enough information -- never ' +
      'invent a task ID, and never assume this succeeded unless it returns ' +
      'success: true.',
    parameters: CreateRoutineArgsSchema,
    execute: (input, runContext) =>
      createRoutine(
        deps,
        requireUserId(runContext),
        input,
        // requireUserId already asserts runContext/context exist.
        runContext!.context,
      ),
  });
}
