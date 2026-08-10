import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Routine, RoutineTask, Task } from '../../generated/prisma/client';
import { RoutinesService } from '../../routines/routines.service';
import { TasksService } from '../../tasks/tasks.service';
import { CreateRoutineTool } from './create-routine.tool';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const ROUTINE_ID = 'a3f1c2d4-1111-4b2a-9c3d-000000000000';

function buildRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: ROUTINE_ID,
    userId: USER_ID,
    title: 'AI-generated plan',
    status: 'active',
    notes: 'Focus on timing',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-id',
    title: 'Chromatic warm-up',
    category: null,
    difficulty: null,
    referenceLink: null,
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildRoutineTask(overrides: Partial<RoutineTask> = {}): RoutineTask {
  return {
    routineId: ROUTINE_ID,
    taskId: 'task-id',
    position: 1,
    targetDurationMinutes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildValidArgs(overrides: Record<string, unknown> = {}) {
  return {
    title: 'AI-generated plan',
    notes: 'Focus on timing',
    tasks: [
      {
        title: 'Chromatic warm-up',
        description: 'Slow chromatic runs across the fretboard',
        durationMinutes: 5,
      },
      {
        title: 'Scale practice',
        description: 'Major scale in three positions',
        durationMinutes: 10,
      },
    ],
    ...overrides,
  };
}

type MockRoutinesService = {
  create: jest.Mock;
  addTask: jest.Mock;
};

type MockTasksService = {
  create: jest.Mock;
};

describe('CreateRoutineTool', () => {
  let tool: CreateRoutineTool;
  let routinesService: MockRoutinesService;
  let tasksService: MockTasksService;

  beforeEach(async () => {
    routinesService = {
      create: jest.fn(),
      addTask: jest.fn(),
    };
    tasksService = {
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateRoutineTool,
        { provide: RoutinesService, useValue: routinesService },
        { provide: TasksService, useValue: tasksService },
      ],
    }).compile();

    tool = module.get<CreateRoutineTool>(CreateRoutineTool);
  });

  describe('execute', () => {
    it('creates the routine and each task in order, returning the result shape', async () => {
      const routine = buildRoutine();
      routinesService.create.mockResolvedValue(routine);
      const createdTask1 = buildTask({ id: 'task-1' });
      const createdTask2 = buildTask({ id: 'task-2', title: 'Scale practice' });
      tasksService.create
        .mockResolvedValueOnce(createdTask1)
        .mockResolvedValueOnce(createdTask2);
      routinesService.addTask
        .mockResolvedValueOnce(
          buildRoutineTask({ taskId: 'task-1', position: 1 }),
        )
        .mockResolvedValueOnce(
          buildRoutineTask({ taskId: 'task-2', position: 2 }),
        );

      const args = buildValidArgs();
      const result = await tool.execute(USER_ID, args);

      expect(routinesService.create).toHaveBeenCalledWith(USER_ID, {
        title: 'AI-generated plan',
        notes: 'Focus on timing',
      });

      expect(tasksService.create).toHaveBeenNthCalledWith(1, {
        title: 'Chromatic warm-up',
        description: 'Slow chromatic runs across the fretboard',
      });
      expect(tasksService.create).toHaveBeenNthCalledWith(2, {
        title: 'Scale practice',
        description: 'Major scale in three positions',
      });

      expect(routinesService.addTask).toHaveBeenNthCalledWith(
        1,
        USER_ID,
        routine.id,
        {
          taskId: 'task-1',
          position: 1,
          targetDurationMinutes: 5,
        },
      );
      expect(routinesService.addTask).toHaveBeenNthCalledWith(
        2,
        USER_ID,
        routine.id,
        {
          taskId: 'task-2',
          position: 2,
          targetDurationMinutes: 10,
        },
      );

      expect(result).toEqual({
        routineId: routine.id,
        title: routine.title,
        taskCount: 2,
      });
    });

    it('assigns sequential positions 1..N for three tasks', async () => {
      const routine = buildRoutine();
      routinesService.create.mockResolvedValue(routine);
      tasksService.create
        .mockResolvedValueOnce(buildTask({ id: 't1' }))
        .mockResolvedValueOnce(buildTask({ id: 't2' }))
        .mockResolvedValueOnce(buildTask({ id: 't3' }));
      routinesService.addTask.mockResolvedValue(buildRoutineTask());

      const args = buildValidArgs({
        tasks: [
          { title: 'Task A', description: 'desc A', durationMinutes: 5 },
          { title: 'Task B', description: 'desc B', durationMinutes: 10 },
          { title: 'Task C', description: 'desc C', durationMinutes: 15 },
        ],
      });

      const result = await tool.execute(USER_ID, args);

      expect(routinesService.addTask).toHaveBeenNthCalledWith(
        1,
        USER_ID,
        routine.id,
        expect.objectContaining({ taskId: 't1', position: 1 }),
      );
      expect(routinesService.addTask).toHaveBeenNthCalledWith(
        2,
        USER_ID,
        routine.id,
        expect.objectContaining({ taskId: 't2', position: 2 }),
      );
      expect(routinesService.addTask).toHaveBeenNthCalledWith(
        3,
        USER_ID,
        routine.id,
        expect.objectContaining({ taskId: 't3', position: 3 }),
      );
      expect(result.taskCount).toBe(3);
    });

    it('rejects with BadRequestException and never calls RoutinesService.create when tasks is missing', async () => {
      const { tasks, ...invalidArgs } = buildValidArgs();
      void tasks;

      await expect(tool.execute(USER_ID, invalidArgs)).rejects.toThrow(
        BadRequestException,
      );
      expect(routinesService.create).not.toHaveBeenCalled();
    });

    it('rejects with BadRequestException when tasks is an empty array', async () => {
      const invalidArgs = buildValidArgs({ tasks: [] });

      await expect(tool.execute(USER_ID, invalidArgs)).rejects.toThrow(
        BadRequestException,
      );
      expect(routinesService.create).not.toHaveBeenCalled();
    });

    it('rejects with BadRequestException when durationMinutes is zero', async () => {
      const invalidArgs = buildValidArgs({
        tasks: [{ title: 'Task A', description: 'desc A', durationMinutes: 0 }],
      });

      await expect(tool.execute(USER_ID, invalidArgs)).rejects.toThrow(
        BadRequestException,
      );
      expect(routinesService.create).not.toHaveBeenCalled();
    });

    it('rejects with BadRequestException when durationMinutes is negative', async () => {
      const invalidArgs = buildValidArgs({
        tasks: [
          { title: 'Task A', description: 'desc A', durationMinutes: -5 },
        ],
      });

      await expect(tool.execute(USER_ID, invalidArgs)).rejects.toThrow(
        BadRequestException,
      );
      expect(routinesService.create).not.toHaveBeenCalled();
    });

    it('rejects with BadRequestException when title is shorter than 2 characters', async () => {
      const invalidArgs = buildValidArgs({ title: 'A' });

      await expect(tool.execute(USER_ID, invalidArgs)).rejects.toThrow(
        BadRequestException,
      );
      expect(routinesService.create).not.toHaveBeenCalled();
    });

    it('ignores a userId field present in rawArgs and always uses the injected userId', async () => {
      const routine = buildRoutine();
      routinesService.create.mockResolvedValue(routine);
      tasksService.create.mockResolvedValue(buildTask());
      routinesService.addTask.mockResolvedValue(buildRoutineTask());

      const argsWithAttackerUserId = {
        ...buildValidArgs(),
        userId: 'attacker-id',
      };

      await tool.execute(USER_ID, argsWithAttackerUserId);

      expect(routinesService.create).toHaveBeenCalledWith(USER_ID, {
        title: 'AI-generated plan',
        notes: 'Focus on timing',
      });
      expect(routinesService.create).not.toHaveBeenCalledWith(
        'attacker-id',
        expect.anything(),
      );
      expect(routinesService.addTask).toHaveBeenCalledWith(
        USER_ID,
        routine.id,
        expect.anything(),
      );
    });

    it('propagates an error thrown by RoutinesService.create', async () => {
      routinesService.create.mockRejectedValue(new Error('db unavailable'));

      await expect(tool.execute(USER_ID, buildValidArgs())).rejects.toThrow(
        'db unavailable',
      );
      expect(tasksService.create).not.toHaveBeenCalled();
    });

    it('propagates an error thrown by TasksService.create', async () => {
      const routine = buildRoutine();
      routinesService.create.mockResolvedValue(routine);
      tasksService.create.mockRejectedValue(new Error('task creation failed'));

      await expect(tool.execute(USER_ID, buildValidArgs())).rejects.toThrow(
        'task creation failed',
      );
      expect(routinesService.addTask).not.toHaveBeenCalled();
    });
  });
});
