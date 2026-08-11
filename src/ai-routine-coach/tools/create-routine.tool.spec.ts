import { NotFoundException } from '@nestjs/common';
import { createRoutine, CreateRoutineArgsSchema } from './create-routine.tool';
import { RoutineCoachContext } from '../agent/routine-coach.context';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const ROUTINE_ID = 'a3f1c2d4-4444-4b2a-9c3d-000000000000';
const TASK_ID_1 = 'a3f1c2d4-1111-4b2a-9c3d-000000000000';
const TASK_ID_2 = 'a3f1c2d4-2222-4b2a-9c3d-000000000001';

type MockRoutinesService = { create: jest.Mock; addTask: jest.Mock };
type MockTasksService = { findById: jest.Mock };

function buildDeps() {
  const routinesService: MockRoutinesService = {
    create: jest.fn(),
    addTask: jest.fn(),
  };
  const tasksService: MockTasksService = { findById: jest.fn() };
  return { routinesService, tasksService };
}

function buildContext(): RoutineCoachContext {
  return { userId: USER_ID };
}

describe('createRoutine', () => {
  it('has no userId parameter in its Zod schema', () => {
    expect(CreateRoutineArgsSchema.shape).not.toHaveProperty('userId');
  });

  it('delegates to RoutinesService.create then addTask in the requested order', async () => {
    const deps = buildDeps();
    deps.tasksService.findById.mockResolvedValue({ id: TASK_ID_1 });
    deps.routinesService.create.mockResolvedValue({
      id: ROUTINE_ID,
      title: 'Daily warm-up',
    });
    const context = buildContext();

    const result = await createRoutine(
      deps,
      USER_ID,
      {
        name: 'Daily warm-up',
        tasks: [{ taskId: TASK_ID_1, durationMinutes: 15, order: 1 }],
      },
      context,
    );

    expect(deps.routinesService.create).toHaveBeenCalledWith(USER_ID, {
      title: 'Daily warm-up',
    });
    expect(deps.routinesService.addTask).toHaveBeenCalledWith(
      USER_ID,
      ROUTINE_ID,
      { taskId: TASK_ID_1, position: 1, targetDurationMinutes: 15 },
    );
    expect(result).toEqual({
      success: true,
      routineId: ROUTINE_ID,
      title: 'Daily warm-up',
      taskCount: 1,
    });
    expect(context.createdRoutine).toEqual({
      routineId: ROUTINE_ID,
      title: 'Daily warm-up',
      taskCount: 1,
    });
  });

  it('adds tasks sequentially sorted by the requested order, not the array order', async () => {
    const deps = buildDeps();
    deps.tasksService.findById.mockResolvedValue({ id: 'any' });
    deps.routinesService.create.mockResolvedValue({
      id: ROUTINE_ID,
      title: 'Daily warm-up',
    });
    const calls: number[] = [];
    deps.routinesService.addTask.mockImplementation(
      (_userId: string, _routineId: string, dto: { position: number }) => {
        calls.push(dto.position);
        return Promise.resolve({});
      },
    );

    await createRoutine(
      deps,
      USER_ID,
      {
        name: 'Daily warm-up',
        tasks: [
          { taskId: TASK_ID_2, durationMinutes: 10, order: 2 },
          { taskId: TASK_ID_1, durationMinutes: 15, order: 1 },
        ],
      },
      buildContext(),
    );

    expect(calls).toEqual([1, 2]);
  });

  it('rejects a duplicate taskId without writing anything', async () => {
    const deps = buildDeps();

    const result = await createRoutine(
      deps,
      USER_ID,
      {
        name: 'Daily warm-up',
        tasks: [
          { taskId: TASK_ID_1, durationMinutes: 10, order: 1 },
          { taskId: TASK_ID_1, durationMinutes: 10, order: 2 },
        ],
      },
      buildContext(),
    );

    expect(result).toEqual({
      success: false,
      error: 'Duplicate taskId in create_routine tasks',
    });
    expect(deps.routinesService.create).not.toHaveBeenCalled();
  });

  it('rejects non-contiguous order values without writing anything', async () => {
    const deps = buildDeps();

    const result = await createRoutine(
      deps,
      USER_ID,
      {
        name: 'Daily warm-up',
        tasks: [
          { taskId: TASK_ID_1, durationMinutes: 10, order: 1 },
          { taskId: TASK_ID_2, durationMinutes: 10, order: 3 },
        ],
      },
      buildContext(),
    );

    expect(result).toEqual({
      success: false,
      error:
        'Task order values must be exactly 1..N with no gaps or duplicates',
    });
    expect(deps.routinesService.create).not.toHaveBeenCalled();
  });

  it('rejects a total duration over the application limit without writing anything', async () => {
    const deps = buildDeps();

    const result = await createRoutine(
      deps,
      USER_ID,
      {
        name: 'Daily warm-up',
        tasks: [
          { taskId: TASK_ID_1, durationMinutes: 120, order: 1 },
          { taskId: TASK_ID_2, durationMinutes: 120, order: 2 },
          {
            taskId: 'a3f1c2d4-3333-4b2a-9c3d-000000000000',
            durationMinutes: 120,
            order: 3,
          },
        ],
      },
      buildContext(),
    );

    expect(result).toEqual({
      success: false,
      error: 'Total routine duration (360m) exceeds the maximum of 240m',
    });
    expect(deps.routinesService.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid taskId before creating the routine', async () => {
    const deps = buildDeps();
    deps.tasksService.findById.mockRejectedValue(
      new NotFoundException('Task not found'),
    );

    const result = await createRoutine(
      deps,
      USER_ID,
      {
        name: 'Daily warm-up',
        tasks: [{ taskId: TASK_ID_1, durationMinutes: 10, order: 1 }],
      },
      buildContext(),
    );

    expect(result).toEqual({ success: false, error: 'Task not found' });
    expect(deps.routinesService.create).not.toHaveBeenCalled();
  });

  it('ignores a userId stuffed into raw tool arguments', async () => {
    const deps = buildDeps();
    deps.tasksService.findById.mockResolvedValue({ id: TASK_ID_1 });
    deps.routinesService.create.mockResolvedValue({
      id: ROUTINE_ID,
      title: 'Daily warm-up',
    });

    await createRoutine(
      deps,
      USER_ID,
      {
        name: 'Daily warm-up',
        userId: 'attacker-supplied-user-id',
        tasks: [{ taskId: TASK_ID_1, durationMinutes: 10, order: 1 }],
      },
      buildContext(),
    );

    expect(deps.routinesService.create).toHaveBeenCalledWith(
      USER_ID,
      expect.anything(),
    );
  });

  it('propagates an unexpected error from RoutinesService.create without setting createdRoutine', async () => {
    const deps = buildDeps();
    deps.tasksService.findById.mockResolvedValue({ id: TASK_ID_1 });
    const unexpected = new Error('database is on fire');
    deps.routinesService.create.mockRejectedValue(unexpected);
    const context = buildContext();

    await expect(
      createRoutine(
        deps,
        USER_ID,
        {
          name: 'Daily warm-up',
          tasks: [{ taskId: TASK_ID_1, durationMinutes: 10, order: 1 }],
        },
        context,
      ),
    ).rejects.toBe(unexpected);
    expect(context.createdRoutine).toBeUndefined();
  });

  it('returns a validation failure for malformed raw arguments instead of throwing', async () => {
    const deps = buildDeps();

    const result = await createRoutine(
      deps,
      USER_ID,
      { name: 'x' },
      buildContext(),
    );

    expect(result.success).toBe(false);
  });
});
