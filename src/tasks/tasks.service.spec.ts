import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Task } from '../generated/prisma/client';
import { meters } from '../observability/metrics/meters';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks.service';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: 'test',
  });
}

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'a3f1c2d4-1111-4b2a-9c3d-000000000000',
    title: 'Chromatic warm-up',
    category: 'technique',
    difficulty: 'easy',
    referenceLink: null,
    description: null,
    ownerId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockPrismaService = {
  task: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  routineTask: { count: jest.Mock };
  practiceSessionTask: { count: jest.Mock };
  $transaction: jest.Mock;
};

type MockCache = {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
};

describe('TasksService', () => {
  let service: TasksService;
  let prisma: MockPrismaService;
  let cache: MockCache;

  beforeEach(async () => {
    prisma = {
      task: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      routineTask: { count: jest.fn().mockResolvedValue(0) },
      practiceSessionTask: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (fn: (tx: MockPrismaService) => Promise<unknown>) => fn(prisma),
    );
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  describe('create', () => {
    it('creates a task via Prisma', async () => {
      const created = buildTask();
      prisma.task.create.mockResolvedValue(created);

      const task = await service.create({
        title: 'Chromatic warm-up',
        category: 'technique',
        difficulty: 'easy',
      });

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: {
          title: 'Chromatic warm-up',
          category: 'technique',
          difficulty: 'easy',
        },
      });
      expect(task).toEqual(created);
    });

    it('bumps the list cache version so stale list caches are not served', async () => {
      prisma.task.create.mockResolvedValue(buildTask());
      cache.get.mockResolvedValue(3);

      await service.create({
        title: 'Chromatic warm-up',
        category: 'technique',
        difficulty: 'easy',
      });

      expect(cache.set).toHaveBeenCalledWith('tasks:list:version', 4, 0);
    });
  });

  describe('findAll', () => {
    it('returns a paginated result using the default page and limit', async () => {
      const tasks = [buildTask(), buildTask({ id: 'other-id' })];
      prisma.task.findMany.mockResolvedValue(tasks);
      prisma.task.count.mockResolvedValue(2);

      const result = await service.findAll({});

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { ownerId: null },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.task.count).toHaveBeenCalledWith({
        where: { ownerId: null },
      });
      expect(result).toEqual({
        data: tasks,
        meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('applies category and difficulty filters with pagination', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      const result = await service.findAll({
        page: 2,
        limit: 5,
        category: 'technique',
        difficulty: 'easy',
      });

      const expectedWhere = {
        ownerId: null,
        category: 'technique',
        difficulty: 'easy',
      };
      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        skip: 5,
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.task.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(result.meta).toEqual({
        total: 0,
        page: 2,
        limit: 5,
        totalPages: 0,
      });
    });

    it('returns the cached result without querying Prisma on a cache hit', async () => {
      const cached = {
        data: [buildTask()],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      };
      cache.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'tasks:list:version' ? undefined : cached),
      );

      const result = await service.findAll({});

      expect(result).toEqual(cached);
      expect(prisma.task.findMany).not.toHaveBeenCalled();
      expect(prisma.task.count).not.toHaveBeenCalled();
    });

    it('caches the computed result under a key scoped to the query and list version', async () => {
      const tasks = [buildTask()];
      prisma.task.findMany.mockResolvedValue(tasks);
      prisma.task.count.mockResolvedValue(1);
      cache.get.mockResolvedValue(undefined);

      const result = await service.findAll({ page: 2, limit: 5 });

      expect(cache.set).toHaveBeenCalledWith('tasks:list:v0:2:5:::', result);
    });

    it('filters on a case-insensitive title match', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      await service.findAll({ q: 'Penta', category: 'technique' });

      const expectedWhere = {
        ownerId: null,
        category: 'technique',
        title: { contains: 'Penta', mode: 'insensitive' },
      };
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.task.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('escapes LIKE wildcards so they match literally', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      await service.findAll({ q: '100%_a\\b' });

      expect(prisma.task.count).toHaveBeenCalledWith({
        where: {
          ownerId: null,
          title: { contains: '100\\%\\_a\\\\b', mode: 'insensitive' },
        },
      });
    });

    it('keys a search by its lower-cased, encoded text', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);
      cache.get.mockResolvedValue(undefined);

      const result = await service.findAll({ q: 'Blues: A/B' });

      expect(cache.set).toHaveBeenCalledWith(
        'tasks:list:v0:1:20:::blues%3A%20a%2Fb',
        result,
      );
    });

    it('gives different searches different keys', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);
      cache.get.mockResolvedValue(undefined);

      await service.findAll({ q: 'blues' });
      await service.findAll({ q: 'jazz' });

      const keys = cache.set.mock.calls.map(([key]) => key as string);
      expect(new Set(keys).size).toBe(2);
    });

    it('falls back to Prisma when the cache is down on read', async () => {
      const tasks = [buildTask()];
      cache.get.mockRejectedValue(new Error('Redis unavailable'));
      prisma.task.findMany.mockResolvedValue(tasks);
      prisma.task.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result).toEqual({
        data: tasks,
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
      expect(prisma.task.findMany).toHaveBeenCalled();
    });

    it('records a cache-get failure metric when the cache is down on read', async () => {
      const addSpy = jest.spyOn(meters.redisOperationFailuresTotal, 'add');
      cache.get.mockRejectedValue(new Error('Redis unavailable'));
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      await service.findAll({});

      expect(addSpy).toHaveBeenCalledWith(1, {
        client: 'cache',
        operation: 'get',
      });
    });

    it('still returns the computed result when the cache is down on write', async () => {
      const tasks = [buildTask()];
      prisma.task.findMany.mockResolvedValue(tasks);
      prisma.task.count.mockResolvedValue(1);
      cache.set.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.findAll({})).resolves.toEqual({
        data: tasks,
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('records a cache-set failure metric when the cache is down on write', async () => {
      const addSpy = jest.spyOn(meters.redisOperationFailuresTotal, 'add');
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);
      cache.set.mockRejectedValue(new Error('Redis unavailable'));

      await service.findAll({});

      expect(addSpy).toHaveBeenCalledWith(1, {
        client: 'cache',
        operation: 'set',
      });
    });
  });

  describe('createMany', () => {
    it('creates every task in one transaction and bumps the list cache once', async () => {
      const created = [buildTask({ id: 'a' }), buildTask({ id: 'b' })];
      prisma.task.create.mockImplementation((args: unknown) => args);
      prisma.$transaction.mockResolvedValue(created);
      cache.get.mockResolvedValue(2);

      const result = await service.createMany([
        { title: 'Riff A' },
        { title: 'Riff B' },
      ]);

      expect(result).toEqual(created);
      expect(prisma.$transaction).toHaveBeenCalledWith([
        { data: { title: 'Riff A' } },
        { data: { title: 'Riff B' } },
      ]);
      expect(cache.set).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith('tasks:list:version', 3, 0);
    });
  });

  describe('createPrivate', () => {
    it('stamps the owner, and leaves the shared list cache alone', async () => {
      prisma.task.create.mockResolvedValue(buildTask({ ownerId: 'u1' }));

      await service.createPrivate('u1', {
        title: 'Riff A',
        description: 'Bars 1-4',
      });

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: { title: 'Riff A', description: 'Bars 1-4', ownerId: 'u1' },
      });
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('findAllUnpaginated', () => {
    it('returns every shared task with no pagination arguments sent to Prisma', async () => {
      const tasks = [buildTask(), buildTask({ id: 'other-id' })];
      prisma.task.findMany.mockResolvedValue(tasks);

      const result = await service.findAllUnpaginated();

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { ownerId: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(tasks);
    });
  });

  describe('findById', () => {
    it("hides another user's private task, even from the cache", async () => {
      cache.get.mockImplementation((key: string) =>
        Promise.resolve(
          key === 'tasks:t-private'
            ? buildTask({ ownerId: 'owner' })
            : undefined,
        ),
      );

      await expect(
        service.findById('t-private', 'someone-else'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.findById('t-private', 'owner'),
      ).resolves.toMatchObject({
        ownerId: 'owner',
      });
    });

    it('returns the matching task', async () => {
      const created = buildTask();
      prisma.task.findUnique.mockResolvedValue(created);

      await expect(service.findById(created.id)).resolves.toEqual(created);
    });

    it('caches the task on a cache miss', async () => {
      const created = buildTask();
      prisma.task.findUnique.mockResolvedValue(created);

      await service.findById(created.id);

      expect(cache.set).toHaveBeenCalledWith(`tasks:${created.id}`, created);
    });

    it('returns the cached task without querying Prisma on a cache hit', async () => {
      const cached = buildTask();
      cache.get.mockResolvedValue(cached);

      await expect(service.findById(cached.id)).resolves.toEqual(cached);
      expect(prisma.task.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.task.findUnique.mockResolvedValue(null);

      await expect(service.findById('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('falls back to Prisma when the cache is down', async () => {
      const created = buildTask();
      cache.get.mockRejectedValue(new Error('Redis unavailable'));
      prisma.task.findUnique.mockResolvedValue(created);

      await expect(service.findById(created.id)).resolves.toEqual(created);
    });
  });

  describe('update', () => {
    it('forwards only the provided fields', async () => {
      const updated = buildTask({ difficulty: 'medium' });
      prisma.task.update.mockResolvedValue(updated);

      const task = await service.update(updated.id, {
        difficulty: 'medium',
      });

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: updated.id },
        data: { difficulty: 'medium' },
      });
      expect(task).toEqual(updated);
    });

    it('invalidates the task cache entry and bumps the list cache version', async () => {
      const updated = buildTask({ difficulty: 'medium' });
      prisma.task.update.mockResolvedValue(updated);
      cache.get.mockResolvedValue(2);

      await service.update(updated.id, { difficulty: 'medium' });

      expect(cache.del).toHaveBeenCalledWith(`tasks:${updated.id}`);
      expect(cache.set).toHaveBeenCalledWith('tasks:list:version', 3, 0);
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.task.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.update('unknown-id', { title: 'New title' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('still returns the updated task when the cache is down', async () => {
      const updated = buildTask({ difficulty: 'medium' });
      prisma.task.update.mockResolvedValue(updated);
      cache.get.mockRejectedValue(new Error('Redis unavailable'));
      cache.del.mockRejectedValue(new Error('Redis unavailable'));
      cache.set.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        service.update(updated.id, { difficulty: 'medium' }),
      ).resolves.toEqual(updated);
    });
  });

  describe('remove', () => {
    it('deletes an unused task', async () => {
      await expect(service.remove('some-id')).resolves.toBeUndefined();
      expect(prisma.task.deleteMany).toHaveBeenCalledWith({
        where: { id: 'some-id' },
      });
    });

    it('invalidates the task cache entry and bumps the list cache version', async () => {
      await service.remove('some-id');

      expect(cache.del).toHaveBeenCalledWith('tasks:some-id');
      expect(cache.set).toHaveBeenCalledWith('tasks:list:version', 1, 0);
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.task.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('throws ConflictException without deleting when a routine uses the task', async () => {
      prisma.routineTask.count.mockResolvedValue(1);

      await expect(service.remove('referenced-id')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.task.deleteMany).not.toHaveBeenCalled();
    });

    it('throws ConflictException without deleting when a practice session uses the task', async () => {
      prisma.practiceSessionTask.count.mockResolvedValue(2);

      await expect(service.remove('referenced-id')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.task.deleteMany).not.toHaveBeenCalled();
    });

    it('still maps a racing foreign-key violation (P2003) to ConflictException', async () => {
      prisma.task.deleteMany.mockRejectedValue(prismaError('P2003'));

      await expect(service.remove('referenced-id')).rejects.toThrow(
        ConflictException,
      );
    });

    it('still succeeds when the cache is down', async () => {
      cache.get.mockRejectedValue(new Error('Redis unavailable'));
      cache.del.mockRejectedValue(new Error('Redis unavailable'));
      cache.set.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.remove('some-id')).resolves.toBeUndefined();
    });
  });
});
