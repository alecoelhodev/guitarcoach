import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, PracticeSession } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoutinesService } from '../routines/routines.service';
import { PracticeSessionsService } from './practice-sessions.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const SESSION_ID = 'a3f1c2d4-1111-4b2a-9c3d-000000000000';
const ROUTINE_ID = 'a3f1c2d4-4444-4b2a-9c3d-000000000000';
const TASK_ID = 'a3f1c2d4-5555-4b2a-9c3d-000000000000';
const OTHER_TASK_ID = 'a3f1c2d4-6666-4b2a-9c3d-000000000000';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: 'test',
  });
}

function buildPracticeSession(
  overrides: Partial<PracticeSession> = {},
): PracticeSession {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    routineId: null,
    title: 'Morning warm-up',
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockPrismaService = {
  practiceSession: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    deleteMany: jest.Mock;
  };
  practiceSessionTask: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  recording: {
    deleteMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

type MockRoutinesService = {
  findById: jest.Mock;
};

describe('PracticeSessionsService', () => {
  let service: PracticeSessionsService;
  let prisma: MockPrismaService;
  let routinesService: MockRoutinesService;

  beforeEach(async () => {
    prisma = {
      practiceSession: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
      },
      practiceSessionTask: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      recording: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    routinesService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RoutinesService, useValue: routinesService },
      ],
    }).compile();

    service = module.get<PracticeSessionsService>(PracticeSessionsService);
  });

  describe('create', () => {
    it('creates a practice session scoped to the owning user', async () => {
      const created = buildPracticeSession();
      prisma.practiceSession.create.mockResolvedValue(created);

      const session = await service.create(USER_ID, {
        title: 'Morning warm-up',
      });

      expect(prisma.practiceSession.create).toHaveBeenCalledWith({
        data: {
          title: 'Morning warm-up',
          userId: USER_ID,
          routineId: undefined,
        },
      });
      expect(session).toEqual(created);
    });

    it('checks routine ownership via RoutinesService before creating', async () => {
      const created = buildPracticeSession({ routineId: ROUTINE_ID });
      routinesService.findById.mockResolvedValue({ id: ROUTINE_ID });
      prisma.practiceSession.create.mockResolvedValue(created);

      await service.create(USER_ID, { routineId: ROUTINE_ID });

      expect(routinesService.findById).toHaveBeenCalledWith(
        USER_ID,
        ROUTINE_ID,
      );
      expect(prisma.practiceSession.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, routineId: ROUTINE_ID },
      });
    });

    it('propagates NotFoundException from RoutinesService when routineId is not owned', async () => {
      routinesService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.create(USER_ID, { routineId: ROUTINE_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.practiceSession.create).not.toHaveBeenCalled();
    });

    it('persists nested session tasks', async () => {
      const created = buildPracticeSession();
      prisma.practiceSession.create.mockResolvedValue(created);

      await service.create(USER_ID, {
        tasks: [
          { taskId: TASK_ID, durationMinutes: 15, completed: true },
          { taskId: OTHER_TASK_ID },
        ],
      });

      expect(prisma.practiceSession.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          routineId: undefined,
          sessionTasks: {
            create: [
              { taskId: TASK_ID, durationMinutes: 15, completed: true },
              {
                taskId: OTHER_TASK_ID,
                durationMinutes: undefined,
                completed: undefined,
              },
            ],
          },
        },
      });
    });

    it('throws NotFoundException when a task does not exist', async () => {
      prisma.practiceSession.create.mockRejectedValue(prismaError('P2003'));

      await expect(
        service.create(USER_ID, { tasks: [{ taskId: 'missing-task' }] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rethrows unexpected errors from the create call', async () => {
      const error = new Error('unexpected');
      prisma.practiceSession.create.mockRejectedValue(error);

      await expect(service.create(USER_ID, {})).rejects.toBe(error);
    });
  });

  describe('findAll', () => {
    it('scopes results to the owning user, most recent first', async () => {
      const sessions = [buildPracticeSession()];
      prisma.practiceSession.findMany.mockResolvedValue(sessions);

      const result = await service.findAll(USER_ID);

      expect(prisma.practiceSession.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(sessions);
    });
  });

  describe('findById', () => {
    it('returns the matching session owned by the user', async () => {
      const created = buildPracticeSession();
      prisma.practiceSession.findFirst.mockResolvedValue(created);

      await expect(service.findById(USER_ID, created.id)).resolves.toEqual(
        created,
      );
      expect(prisma.practiceSession.findFirst).toHaveBeenCalledWith({
        where: { id: created.id, userId: USER_ID },
      });
    });

    it('throws NotFoundException when no session matches for the user', async () => {
      prisma.practiceSession.findFirst.mockResolvedValue(null);

      await expect(service.findById(USER_ID, 'unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteByTitle', () => {
    it('deletes dependent recordings and tasks before the owning sessions', async () => {
      prisma.recording.deleteMany.mockResolvedValue({ count: 2 });
      prisma.practiceSessionTask.deleteMany.mockResolvedValue({ count: 3 });
      prisma.practiceSession.deleteMany.mockResolvedValue({ count: 1 });

      const deletedCount = await service.deleteByTitle(
        USER_ID,
        'k6 practice session',
      );

      expect(prisma.recording.deleteMany).toHaveBeenCalledWith({
        where: {
          practiceSession: { userId: USER_ID, title: 'k6 practice session' },
        },
      });
      expect(prisma.practiceSessionTask.deleteMany).toHaveBeenCalledWith({
        where: {
          practiceSession: { userId: USER_ID, title: 'k6 practice session' },
        },
      });
      expect(prisma.practiceSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, title: 'k6 practice session' },
      });
      expect(deletedCount).toBe(1);
    });

    it('returns zero, not a NotFoundException, when nothing matches', async () => {
      prisma.recording.deleteMany.mockResolvedValue({ count: 0 });
      prisma.practiceSessionTask.deleteMany.mockResolvedValue({ count: 0 });
      prisma.practiceSession.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteByTitle(USER_ID, 'no such title'),
      ).resolves.toBe(0);
    });

    it('scopes the delete to the calling user only', async () => {
      prisma.recording.deleteMany.mockResolvedValue({ count: 0 });
      prisma.practiceSessionTask.deleteMany.mockResolvedValue({ count: 0 });
      prisma.practiceSession.deleteMany.mockResolvedValue({ count: 0 });

      await service.deleteByTitle(USER_ID, 'Morning warm-up');

      const call = prisma.practiceSession.deleteMany.mock.calls[0] as [
        { where: { userId: string } },
      ];
      expect(call[0].where.userId).toBe(USER_ID);
      expect(call[0].where.userId).not.toBe('some-other-user-id');
    });
  });

  describe('findRecent', () => {
    it('scopes results to the owning user within the lookback window', async () => {
      const sessions = [buildPracticeSession()];
      prisma.practiceSession.findMany.mockResolvedValue(sessions);

      const result = await service.findRecent(USER_ID, 14);

      const firstCallArgs = prisma.practiceSession.findMany.mock
        .calls[0] as unknown[];
      const call = firstCallArgs[0] as {
        where: { userId: string; createdAt: { gte: Date } };
        orderBy: unknown;
        include: unknown;
      };
      expect(call.where.userId).toBe(USER_ID);
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(call.include).toEqual({
        routine: { select: { id: true, title: true } },
        sessionTasks: {
          include: { task: { select: { id: true, title: true } } },
        },
      });
      expect(result).toEqual(sessions);
    });
  });

  describe('getTaskStats', () => {
    it('splits recent-window counts from all-time counts per task', async () => {
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const recentRow = {
        taskId: TASK_ID,
        durationMinutes: 10,
        createdAt: oneDayAgo,
        task: { id: TASK_ID, title: 'Scales' },
      };
      const oldRow = {
        taskId: OTHER_TASK_ID,
        durationMinutes: 20,
        createdAt: fortyDaysAgo,
        task: { id: OTHER_TASK_ID, title: 'Improvisation' },
      };
      prisma.practiceSessionTask.findMany.mockResolvedValue([
        recentRow,
        oldRow,
      ]);

      const stats = await service.getTaskStats(USER_ID, 14);

      expect(prisma.practiceSessionTask.findMany).toHaveBeenCalledWith({
        where: { practiceSession: { userId: USER_ID } },
        include: { task: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const scales = stats.find((stat) => stat.taskId === TASK_ID);
      const improv = stats.find((stat) => stat.taskId === OTHER_TASK_ID);

      expect(scales).toMatchObject({
        title: 'Scales',
        timesPracticedRecently: 1,
        totalMinutesPracticedRecently: 10,
        timesPracticedAllTime: 1,
      });
      expect(improv).toMatchObject({
        title: 'Improvisation',
        timesPracticedRecently: 0,
        totalMinutesPracticedRecently: 0,
        timesPracticedAllTime: 1,
      });
      expect(improv?.lastPracticedAt).toBe(oldRow.createdAt.toISOString());
    });

    it('omits tasks with no practice history at all', async () => {
      prisma.practiceSessionTask.findMany.mockResolvedValue([]);

      const stats = await service.getTaskStats(USER_ID, 14);

      expect(stats).toEqual([]);
    });
  });
});
