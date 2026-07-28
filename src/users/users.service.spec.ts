import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: 'test',
  });
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'a3f1c2d4-1111-4b2a-9c3d-000000000000',
    email: 'jordan@example.com',
    displayName: 'Jordan',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockPrismaService = {
  user: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = {
      user: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('create', () => {
    it('creates a user via Prisma with a normalized email', async () => {
      const created = buildUser();
      prisma.user.create.mockResolvedValue(created);

      const user = await service.create({
        email: '  Jordan@Example.COM  ',
        displayName: 'Jordan',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'jordan@example.com', displayName: 'Jordan' },
      });
      expect(user).toEqual(created);
    });

    it('translates a unique constraint violation into ConflictException', async () => {
      prisma.user.create.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.create({ email: 'jordan@example.com', displayName: 'Jordan' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns all users from Prisma', async () => {
      const users = [buildUser(), buildUser({ id: 'other-id' })];
      prisma.user.findMany.mockResolvedValue(users);

      await expect(service.findAll()).resolves.toEqual(users);
    });
  });

  describe('findById', () => {
    it('returns the matching user', async () => {
      const created = buildUser();
      prisma.user.findUnique.mockResolvedValue(created);

      await expect(service.findById(created.id)).resolves.toEqual(created);
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('normalizes email and forwards only provided fields', async () => {
      const updated = buildUser({ email: 'jordan2@example.com' });
      prisma.user.update.mockResolvedValue(updated);

      const user = await service.update(updated.id, {
        email: '  Jordan2@Example.COM ',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: updated.id },
        data: { email: 'jordan2@example.com' },
      });
      expect(user).toEqual(updated);
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.update('unknown-id', { displayName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects updating to another user email with ConflictException', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.update('some-id', { email: 'a@example.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('deletes an existing user', async () => {
      prisma.user.delete.mockResolvedValue(buildUser());

      await expect(service.remove('some-id')).resolves.toBeUndefined();
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'some-id' },
      });
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.user.delete.mockRejectedValue(prismaError('P2025'));

      await expect(service.remove('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
