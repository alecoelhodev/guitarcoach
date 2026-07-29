import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Task } from '../generated/prisma/client';
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
    delete: jest.Mock;
  };
};

describe('TasksService', () => {
  let service: TasksService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = {
      task: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TasksService, { provide: PrismaService, useValue: prisma }],
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
  });

  describe('findAll', () => {
    it('returns a paginated result using the default page and limit', async () => {
      const tasks = [buildTask(), buildTask({ id: 'other-id' })];
      prisma.task.findMany.mockResolvedValue(tasks);
      prisma.task.count.mockResolvedValue(2);

      const result = await service.findAll({});

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.task.count).toHaveBeenCalledWith({ where: {} });
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

      const expectedWhere = { category: 'technique', difficulty: 'easy' };
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
  });

  describe('findById', () => {
    it('returns the matching task', async () => {
      const created = buildTask();
      prisma.task.findUnique.mockResolvedValue(created);

      await expect(service.findById(created.id)).resolves.toEqual(created);
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.task.findUnique.mockResolvedValue(null);

      await expect(service.findById('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
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

    it('throws NotFoundException for an unknown id', async () => {
      prisma.task.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.update('unknown-id', { title: 'New title' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes an existing task', async () => {
      prisma.task.delete.mockResolvedValue(buildTask());

      await expect(service.remove('some-id')).resolves.toBeUndefined();
      expect(prisma.task.delete).toHaveBeenCalledWith({
        where: { id: 'some-id' },
      });
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.task.delete.mockRejectedValue(prismaError('P2025'));

      await expect(service.remove('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the task is referenced by a routine', async () => {
      prisma.task.delete.mockRejectedValue(prismaError('P2003'));

      await expect(service.remove('referenced-id')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
