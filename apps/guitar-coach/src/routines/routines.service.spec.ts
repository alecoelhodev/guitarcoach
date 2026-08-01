import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Routine, RoutineTask, Task } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { RoutineCreatedProducer } from './events/routine-created.producer';
import { RoutinesService } from './routines.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const ROUTINE_ID = 'a3f1c2d4-1111-4b2a-9c3d-000000000000';
const TASK_ID = 'a3f1c2d4-3333-4b2a-9c3d-000000000000';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: 'test',
  });
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

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    title: 'Chromatic finger warm-up',
    category: 'technique',
    difficulty: 'easy',
    referenceLink: null,
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockPrismaService = {
  routine: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    deleteMany: jest.Mock;
  };
  routineTask: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
};

type MockRedisLockService = {
  acquire: jest.Mock;
  release: jest.Mock;
};

type MockRoutineCreatedProducer = {
  publish: jest.Mock;
};

const LOCK_TOKEN = 'lock-token';

describe('RoutinesService', () => {
  let service: RoutinesService;
  let prisma: MockPrismaService;
  let redisLock: MockRedisLockService;
  let routineCreatedProducer: MockRoutineCreatedProducer;

  beforeEach(async () => {
    prisma = {
      routine: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        deleteMany: jest.fn(),
      },
      routineTask: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    // addTask/updateTask/removeTask/reorderTasks all start with the same
    // ownership check (findById -> prisma.routine.findFirst); default it to
    // "found" so each describe block only overrides it when testing the
    // not-found/not-owned path.
    prisma.routine.findFirst.mockResolvedValue(buildRoutine());

    redisLock = {
      acquire: jest.fn(),
      release: jest.fn(),
    };
    // reorderTasks acquires this lock before doing anything else; default it
    // to "acquired" so only the lock-conflict test needs to override it.
    redisLock.acquire.mockResolvedValue(LOCK_TOKEN);

    routineCreatedProducer = { publish: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutinesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisLockService, useValue: redisLock },
        { provide: RoutineCreatedProducer, useValue: routineCreatedProducer },
      ],
    }).compile();

    service = module.get<RoutinesService>(RoutinesService);
  });

  describe('create', () => {
    it('creates a routine scoped to the owning user', async () => {
      const created = buildRoutine();
      prisma.routine.create.mockResolvedValue(created);

      const routine = await service.create(USER_ID, { title: 'Daily warm-up' });

      expect(prisma.routine.create).toHaveBeenCalledWith({
        data: { title: 'Daily warm-up', userId: USER_ID },
      });
      expect(routine).toEqual(created);
    });

    it('publishes a routine.created event after a successful create', async () => {
      const created = buildRoutine();
      prisma.routine.create.mockResolvedValue(created);

      await service.create(USER_ID, { title: 'Daily warm-up' });

      expect(routineCreatedProducer.publish).toHaveBeenCalledWith(created);
    });

    it('still returns the created routine when publishing throws synchronously', async () => {
      const created = buildRoutine();
      prisma.routine.create.mockResolvedValue(created);
      routineCreatedProducer.publish.mockImplementation(() => {
        throw new Error('broker unavailable');
      });

      await expect(
        service.create(USER_ID, { title: 'Daily warm-up' }),
      ).resolves.toEqual(created);
    });
  });

  describe('findAll', () => {
    it('scopes results to the owning user with default pagination', async () => {
      const routines = [buildRoutine(), buildRoutine({ id: 'other-id' })];
      prisma.routine.findMany.mockResolvedValue(routines);
      prisma.routine.count.mockResolvedValue(2);

      const result = await service.findAll(USER_ID, {});

      expect(prisma.routine.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.routine.count).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
      expect(result).toEqual({
        data: routines,
        meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('applies the status filter with pagination', async () => {
      prisma.routine.findMany.mockResolvedValue([]);
      prisma.routine.count.mockResolvedValue(0);

      const result = await service.findAll(USER_ID, {
        page: 2,
        limit: 5,
        status: 'archived',
      });

      const expectedWhere = { userId: USER_ID, status: 'archived' };
      expect(prisma.routine.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        skip: 5,
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.routine.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
      expect(result.meta).toEqual({
        total: 0,
        page: 2,
        limit: 5,
        totalPages: 0,
      });
    });
  });

  describe('findById', () => {
    it('returns the matching routine owned by the user', async () => {
      const created = buildRoutine();
      prisma.routine.findFirst.mockResolvedValue(created);

      await expect(service.findById(USER_ID, created.id)).resolves.toEqual(
        created,
      );
      expect(prisma.routine.findFirst).toHaveBeenCalledWith({
        where: { id: created.id, userId: USER_ID },
      });
    });

    it('throws NotFoundException when no routine matches for the user', async () => {
      prisma.routine.findFirst.mockResolvedValue(null);

      await expect(service.findById(USER_ID, 'unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates only a routine owned by the user', async () => {
      const updated = buildRoutine({ status: 'archived' });
      prisma.routine.updateMany.mockResolvedValue({ count: 1 });
      prisma.routine.findUniqueOrThrow.mockResolvedValue(updated);

      const routine = await service.update(USER_ID, updated.id, {
        status: 'archived',
      });

      expect(prisma.routine.updateMany).toHaveBeenCalledWith({
        where: { id: updated.id, userId: USER_ID },
        data: { status: 'archived' },
      });
      expect(routine).toEqual(updated);
    });

    it('throws NotFoundException when no routine matches for the user', async () => {
      prisma.routine.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update(USER_ID, 'unknown-id', { title: 'New title' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.routine.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes a routine owned by the user', async () => {
      prisma.routine.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.remove(USER_ID, 'some-id')).resolves.toBeUndefined();
      expect(prisma.routine.deleteMany).toHaveBeenCalledWith({
        where: { id: 'some-id', userId: USER_ID },
      });
    });

    it('throws NotFoundException when no routine matches for the user', async () => {
      prisma.routine.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(USER_ID, 'unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the routine has tasks assigned', async () => {
      prisma.routine.deleteMany.mockRejectedValue(prismaError('P2003'));

      await expect(service.remove(USER_ID, 'referenced-id')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findTasks', () => {
    it('returns the routine tasks with nested task data, ordered by position', async () => {
      const routineTasks = [
        { ...buildRoutineTask({ position: 1 }), task: buildTask() },
      ];
      prisma.routineTask.findMany.mockResolvedValue(routineTasks);

      const result = await service.findTasks(USER_ID, ROUTINE_ID);

      expect(prisma.routine.findFirst).toHaveBeenCalledWith({
        where: { id: ROUTINE_ID, userId: USER_ID },
      });
      expect(prisma.routineTask.findMany).toHaveBeenCalledWith({
        where: { routineId: ROUTINE_ID },
        orderBy: { position: 'asc' },
        include: { task: true },
      });
      expect(result).toEqual(routineTasks);
    });

    it('returns an empty array when the routine has no tasks', async () => {
      prisma.routineTask.findMany.mockResolvedValue([]);

      await expect(service.findTasks(USER_ID, ROUTINE_ID)).resolves.toEqual([]);
    });

    it('throws NotFoundException when the routine is not owned by the user', async () => {
      prisma.routine.findFirst.mockResolvedValue(null);

      await expect(service.findTasks(USER_ID, ROUTINE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.routineTask.findMany).not.toHaveBeenCalled();
    });
  });

  describe('addTask', () => {
    it('appends the task at the next position when none is given', async () => {
      prisma.routineTask.findFirst.mockResolvedValue(
        buildRoutineTask({ position: 3 }),
      );
      const created = buildRoutineTask({ position: 4 });
      prisma.routineTask.create.mockResolvedValue(created);

      const result = await service.addTask(USER_ID, ROUTINE_ID, {
        taskId: TASK_ID,
      });

      expect(prisma.routine.findFirst).toHaveBeenCalledWith({
        where: { id: ROUTINE_ID, userId: USER_ID },
      });
      expect(prisma.routineTask.findFirst).toHaveBeenCalledWith({
        where: { routineId: ROUTINE_ID },
        orderBy: { position: 'desc' },
      });
      expect(prisma.routineTask.create).toHaveBeenCalledWith({
        data: {
          routineId: ROUTINE_ID,
          taskId: TASK_ID,
          position: 4,
          targetDurationMinutes: undefined,
        },
      });
      expect(result).toEqual(created);
    });

    it('starts at position 1 when the routine has no tasks yet', async () => {
      prisma.routineTask.findFirst.mockResolvedValue(null);
      prisma.routineTask.create.mockResolvedValue(buildRoutineTask());

      await service.addTask(USER_ID, ROUTINE_ID, { taskId: TASK_ID });

      expect(prisma.routineTask.create).toHaveBeenCalledWith({
        data: {
          routineId: ROUTINE_ID,
          taskId: TASK_ID,
          position: 1,
          targetDurationMinutes: undefined,
        },
      });
    });

    it('uses the given position without querying the current max', async () => {
      prisma.routineTask.create.mockResolvedValue(
        buildRoutineTask({ position: 2, targetDurationMinutes: 10 }),
      );

      await service.addTask(USER_ID, ROUTINE_ID, {
        taskId: TASK_ID,
        position: 2,
        targetDurationMinutes: 10,
      });

      expect(prisma.routineTask.findFirst).not.toHaveBeenCalled();
      expect(prisma.routineTask.create).toHaveBeenCalledWith({
        data: {
          routineId: ROUTINE_ID,
          taskId: TASK_ID,
          position: 2,
          targetDurationMinutes: 10,
        },
      });
    });

    it('throws NotFoundException when the routine is not owned by the user', async () => {
      prisma.routine.findFirst.mockResolvedValue(null);

      await expect(
        service.addTask(USER_ID, ROUTINE_ID, { taskId: TASK_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.routineTask.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the task does not exist', async () => {
      prisma.routineTask.create.mockRejectedValue(prismaError('P2003'));

      await expect(
        service.addTask(USER_ID, ROUTINE_ID, { taskId: TASK_ID, position: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the task or position is already taken', async () => {
      prisma.routineTask.create.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.addTask(USER_ID, ROUTINE_ID, { taskId: TASK_ID, position: 1 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateTask', () => {
    it('updates the task assignment scoped to the owned routine', async () => {
      const updated = buildRoutineTask({ targetDurationMinutes: 15 });
      prisma.routineTask.update.mockResolvedValue(updated);

      const result = await service.updateTask(USER_ID, ROUTINE_ID, TASK_ID, {
        targetDurationMinutes: 15,
      });

      expect(prisma.routine.findFirst).toHaveBeenCalledWith({
        where: { id: ROUTINE_ID, userId: USER_ID },
      });
      expect(prisma.routineTask.update).toHaveBeenCalledWith({
        where: { routineId_taskId: { routineId: ROUTINE_ID, taskId: TASK_ID } },
        data: { targetDurationMinutes: 15 },
      });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException when the routine is not owned by the user', async () => {
      prisma.routine.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTask(USER_ID, ROUTINE_ID, TASK_ID, { position: 2 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.routineTask.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the task is not assigned to the routine', async () => {
      prisma.routineTask.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.updateTask(USER_ID, ROUTINE_ID, TASK_ID, { position: 2 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the new position is already taken', async () => {
      prisma.routineTask.update.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.updateTask(USER_ID, ROUTINE_ID, TASK_ID, { position: 2 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeTask', () => {
    it('removes the task assignment scoped to the owned routine', async () => {
      prisma.routineTask.delete.mockResolvedValue(buildRoutineTask());

      await expect(
        service.removeTask(USER_ID, ROUTINE_ID, TASK_ID),
      ).resolves.toBeUndefined();
      expect(prisma.routineTask.delete).toHaveBeenCalledWith({
        where: { routineId_taskId: { routineId: ROUTINE_ID, taskId: TASK_ID } },
      });
    });

    it('throws NotFoundException when the routine is not owned by the user', async () => {
      prisma.routine.findFirst.mockResolvedValue(null);

      await expect(
        service.removeTask(USER_ID, ROUTINE_ID, TASK_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.routineTask.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the task is not assigned to the routine', async () => {
      prisma.routineTask.delete.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.removeTask(USER_ID, ROUTINE_ID, TASK_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reorderTasks', () => {
    const TASK_ID_2 = 'a3f1c2d4-4444-4b2a-9c3d-000000000000';
    const TASK_ID_3 = 'a3f1c2d4-5555-4b2a-9c3d-000000000000';

    it('reorders tasks via a two-phase transaction and returns them in the new order', async () => {
      prisma.routineTask.findMany
        .mockResolvedValueOnce([
          buildRoutineTask({ taskId: TASK_ID, position: 1 }),
          buildRoutineTask({ taskId: TASK_ID_2, position: 2 }),
          buildRoutineTask({ taskId: TASK_ID_3, position: 3 }),
        ])
        .mockResolvedValueOnce([
          buildRoutineTask({ taskId: TASK_ID_3, position: 1 }),
          buildRoutineTask({ taskId: TASK_ID, position: 2 }),
          buildRoutineTask({ taskId: TASK_ID_2, position: 3 }),
        ]);
      prisma.routineTask.update.mockReturnValue('update-call');
      prisma.$transaction.mockResolvedValue([]);

      const result = await service.reorderTasks(USER_ID, ROUTINE_ID, {
        taskIds: [TASK_ID_3, TASK_ID, TASK_ID_2],
      });

      expect(prisma.$transaction).toHaveBeenCalledWith([
        'update-call',
        'update-call',
        'update-call',
        'update-call',
        'update-call',
        'update-call',
      ]);
      expect(prisma.routineTask.update).toHaveBeenNthCalledWith(1, {
        where: {
          routineId_taskId: { routineId: ROUTINE_ID, taskId: TASK_ID_3 },
        },
        data: { position: -1 },
      });
      expect(prisma.routineTask.update).toHaveBeenNthCalledWith(2, {
        where: { routineId_taskId: { routineId: ROUTINE_ID, taskId: TASK_ID } },
        data: { position: -2 },
      });
      expect(prisma.routineTask.update).toHaveBeenNthCalledWith(3, {
        where: {
          routineId_taskId: { routineId: ROUTINE_ID, taskId: TASK_ID_2 },
        },
        data: { position: -3 },
      });
      expect(prisma.routineTask.update).toHaveBeenNthCalledWith(4, {
        where: {
          routineId_taskId: { routineId: ROUTINE_ID, taskId: TASK_ID_3 },
        },
        data: { position: 1 },
      });
      expect(prisma.routineTask.update).toHaveBeenNthCalledWith(5, {
        where: { routineId_taskId: { routineId: ROUTINE_ID, taskId: TASK_ID } },
        data: { position: 2 },
      });
      expect(prisma.routineTask.update).toHaveBeenNthCalledWith(6, {
        where: {
          routineId_taskId: { routineId: ROUTINE_ID, taskId: TASK_ID_2 },
        },
        data: { position: 3 },
      });
      expect(result[0].taskId).toBe(TASK_ID_3);
    });

    it('acquires a per-routine reorder lock and releases it on success', async () => {
      prisma.routineTask.findMany.mockResolvedValue([
        buildRoutineTask({ taskId: TASK_ID, position: 1 }),
      ]);
      prisma.routineTask.update.mockReturnValue('update-call');
      prisma.$transaction.mockResolvedValue([]);

      await service.reorderTasks(USER_ID, ROUTINE_ID, {
        taskIds: [TASK_ID],
      });

      const lockKey = `lock:routine:${ROUTINE_ID}:reorder`;
      expect(redisLock.acquire).toHaveBeenCalledWith(lockKey, 5000);
      expect(redisLock.release).toHaveBeenCalledWith(lockKey, LOCK_TOKEN);
      // Lock must be held for the whole critical section: released only
      // after the transaction (and the read-back that follows it) complete.
      expect(redisLock.release.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('throws ServiceUnavailableException when acquiring the lock fails', async () => {
      redisLock.acquire.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        service.reorderTasks(USER_ID, ROUTINE_ID, { taskIds: [TASK_ID] }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.routineTask.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('still returns the reordered result when releasing the lock fails', async () => {
      const reordered = [buildRoutineTask({ taskId: TASK_ID, position: 1 })];
      prisma.routineTask.findMany.mockResolvedValue(reordered);
      prisma.routineTask.update.mockReturnValue('update-call');
      prisma.$transaction.mockResolvedValue([]);
      redisLock.release.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        service.reorderTasks(USER_ID, ROUTINE_ID, { taskIds: [TASK_ID] }),
      ).resolves.toEqual(reordered);
    });

    it('throws ConflictException without touching the database when the routine is already locked', async () => {
      redisLock.acquire.mockResolvedValue(null);

      await expect(
        service.reorderTasks(USER_ID, ROUTINE_ID, { taskIds: [TASK_ID] }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.routineTask.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      // Nothing to release: acquisition never handed back a token.
      expect(redisLock.release).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the routine is not owned by the user', async () => {
      prisma.routine.findFirst.mockResolvedValue(null);

      await expect(
        service.reorderTasks(USER_ID, ROUTINE_ID, { taskIds: [TASK_ID] }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.routineTask.findMany).not.toHaveBeenCalled();
      expect(redisLock.acquire).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a taskId is missing from the request', async () => {
      prisma.routineTask.findMany.mockResolvedValue([
        buildRoutineTask({ taskId: TASK_ID, position: 1 }),
        buildRoutineTask({ taskId: TASK_ID_2, position: 2 }),
      ]);

      await expect(
        service.reorderTasks(USER_ID, ROUTINE_ID, { taskIds: [TASK_ID] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      // Lock must still be released even though validation rejected the request.
      expect(redisLock.release).toHaveBeenCalledWith(
        `lock:routine:${ROUTINE_ID}:reorder`,
        LOCK_TOKEN,
      );
    });

    it('releases the lock even when the transaction throws', async () => {
      prisma.routineTask.findMany.mockResolvedValue([
        buildRoutineTask({ taskId: TASK_ID, position: 1 }),
      ]);
      prisma.routineTask.update.mockReturnValue('update-call');
      prisma.$transaction.mockRejectedValue(new Error('transaction failed'));

      await expect(
        service.reorderTasks(USER_ID, ROUTINE_ID, { taskIds: [TASK_ID] }),
      ).rejects.toThrow('transaction failed');
      expect(redisLock.release).toHaveBeenCalledWith(
        `lock:routine:${ROUTINE_ID}:reorder`,
        LOCK_TOKEN,
      );
    });

    it('throws BadRequestException when a taskId is duplicated', async () => {
      prisma.routineTask.findMany.mockResolvedValue([
        buildRoutineTask({ taskId: TASK_ID, position: 1 }),
        buildRoutineTask({ taskId: TASK_ID_2, position: 2 }),
      ]);

      await expect(
        service.reorderTasks(USER_ID, ROUTINE_ID, {
          taskIds: [TASK_ID, TASK_ID],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when an unknown taskId is included', async () => {
      prisma.routineTask.findMany.mockResolvedValue([
        buildRoutineTask({ taskId: TASK_ID, position: 1 }),
      ]);

      await expect(
        service.reorderTasks(USER_ID, ROUTINE_ID, {
          taskIds: [TASK_ID_2],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
