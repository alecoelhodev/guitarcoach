import { Test, TestingModule } from '@nestjs/testing';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { Routine, RoutineTask } from '../generated/prisma/client';
import { RoutinesController } from './routines.controller';
import { PaginatedResult, RoutinesService } from './routines.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const ROUTINE_ID = 'a3f1c2d4-1111-4b2a-9c3d-000000000000';
const TASK_ID = 'a3f1c2d4-3333-4b2a-9c3d-000000000000';

function buildSession(): UserSession {
  return { user: { id: USER_ID } } as UserSession;
}

function buildRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: ROUTINE_ID,
    userId: USER_ID,
    title: 'Daily warm-up',
    status: 'active',
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildRoutineTask(overrides: Partial<RoutineTask> = {}): RoutineTask {
  return {
    routineId: ROUTINE_ID,
    taskId: TASK_ID,
    position: 1,
    targetDurationMinutes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('RoutinesController', () => {
  let controller: RoutinesController;
  let service: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    addTask: jest.Mock;
    updateTask: jest.Mock;
    removeTask: jest.Mock;
    reorderTasks: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      addTask: jest.fn(),
      updateTask: jest.fn(),
      removeTask: jest.fn(),
      reorderTasks: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoutinesController],
      providers: [{ provide: RoutinesService, useValue: service }],
    }).compile();

    controller = module.get<RoutinesController>(RoutinesController);
  });

  // The controller derives userId from the session, never from the request
  // body/query — otherwise a caller could read or mutate another user's
  // routines by passing an arbitrary userId. These tests pin that contract.

  it('scopes create() to the session user', async () => {
    const created = buildRoutine();
    service.create.mockResolvedValue(created);

    const result = await controller.create(buildSession(), {
      title: 'Daily warm-up',
    });

    expect(service.create).toHaveBeenCalledWith(USER_ID, {
      title: 'Daily warm-up',
    });
    expect(result).toEqual(created);
  });

  it('scopes findAll() to the session user', async () => {
    const paginated: PaginatedResult<Routine> = {
      data: [buildRoutine()],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    };
    service.findAll.mockResolvedValue(paginated);

    const result = await controller.findAll(buildSession(), {});

    expect(service.findAll).toHaveBeenCalledWith(USER_ID, {});
    expect(result).toEqual(paginated);
  });

  it('scopes findOne() to the session user', async () => {
    const routine = buildRoutine();
    service.findById.mockResolvedValue(routine);

    const result = await controller.findOne(buildSession(), routine.id);

    expect(service.findById).toHaveBeenCalledWith(USER_ID, routine.id);
    expect(result).toEqual(routine);
  });

  it('scopes update() to the session user', async () => {
    const routine = buildRoutine({ status: 'archived' });
    service.update.mockResolvedValue(routine);

    const result = await controller.update(buildSession(), routine.id, {
      status: 'archived',
    });

    expect(service.update).toHaveBeenCalledWith(USER_ID, routine.id, {
      status: 'archived',
    });
    expect(result).toEqual(routine);
  });

  it('scopes remove() to the session user', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove(buildSession(), 'some-id');

    expect(service.remove).toHaveBeenCalledWith(USER_ID, 'some-id');
  });

  it('scopes addTask() to the session user', async () => {
    const routineTask = buildRoutineTask();
    service.addTask.mockResolvedValue(routineTask);

    const result = await controller.addTask(buildSession(), ROUTINE_ID, {
      taskId: TASK_ID,
    });

    expect(service.addTask).toHaveBeenCalledWith(USER_ID, ROUTINE_ID, {
      taskId: TASK_ID,
    });
    expect(result).toEqual(routineTask);
  });

  it('scopes reorderTasks() to the session user', async () => {
    const routineTasks = [buildRoutineTask()];
    service.reorderTasks.mockResolvedValue(routineTasks);

    const result = await controller.reorderTasks(buildSession(), ROUTINE_ID, {
      taskIds: [TASK_ID],
    });

    expect(service.reorderTasks).toHaveBeenCalledWith(USER_ID, ROUTINE_ID, {
      taskIds: [TASK_ID],
    });
    expect(result).toEqual(routineTasks);
  });

  it('scopes updateTask() to the session user', async () => {
    const routineTask = buildRoutineTask({ position: 2 });
    service.updateTask.mockResolvedValue(routineTask);

    const result = await controller.updateTask(
      buildSession(),
      ROUTINE_ID,
      TASK_ID,
      { position: 2 },
    );

    expect(service.updateTask).toHaveBeenCalledWith(
      USER_ID,
      ROUTINE_ID,
      TASK_ID,
      { position: 2 },
    );
    expect(result).toEqual(routineTask);
  });

  it('scopes removeTask() to the session user', async () => {
    service.removeTask.mockResolvedValue(undefined);

    await controller.removeTask(buildSession(), ROUTINE_ID, TASK_ID);

    expect(service.removeTask).toHaveBeenCalledWith(
      USER_ID,
      ROUTINE_ID,
      TASK_ID,
    );
  });
});
