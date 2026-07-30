import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Routine } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoutinesService } from './routines.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: 'test',
  });
}

function buildRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'a3f1c2d4-1111-4b2a-9c3d-000000000000',
    userId: USER_ID,
    title: 'Daily warm-up',
    status: 'active',
    notes: null,
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
};

describe('RoutinesService', () => {
  let service: RoutinesService;
  let prisma: MockPrismaService;

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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutinesService,
        { provide: PrismaService, useValue: prisma },
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
});
