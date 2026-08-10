import { BadRequestException, Injectable } from '@nestjs/common';
import { RoutinesService } from '../../routines/routines.service';
import { TasksService } from '../../tasks/tasks.service';
import {
  CreateRoutineArgsSchema,
  CreateRoutineResult,
} from './create-routine.types';

// The one narrow, purpose-built tool the AI may call to persist a plan.
// Executes exclusively through RoutinesService/TasksService -- never touches
// Prisma directly -- and always uses the server-injected `userId`, never a
// value from the model's arguments (the schema has no `userId` field at all).
@Injectable()
export class CreateRoutineTool {
  constructor(
    private readonly routinesService: RoutinesService,
    private readonly tasksService: TasksService,
  ) {}

  async execute(
    userId: string,
    rawArgs: unknown,
  ): Promise<CreateRoutineResult> {
    // Re-validate independently: don't assume the OpenAI SDK's upstream
    // schema validation held by the time this method is invoked.
    const parsed = CreateRoutineArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid create_routine tool arguments: ${parsed.error.message}`,
      );
    }
    const args = parsed.data;

    const routine = await this.routinesService.create(userId, {
      title: args.title,
      notes: args.notes,
    });

    // Sequential, not Promise.all: position must be assigned deterministically
    // 1..N in the order the model gave the tasks.
    for (let index = 0; index < args.tasks.length; index++) {
      const task = args.tasks[index];
      const createdTask = await this.tasksService.create({
        title: task.title,
        description: task.description,
      });
      await this.routinesService.addTask(userId, routine.id, {
        taskId: createdTask.id,
        position: index + 1,
        targetDurationMinutes: task.durationMinutes,
      });
    }

    return {
      routineId: routine.id,
      title: routine.title,
      taskCount: args.tasks.length,
    };
  }
}
