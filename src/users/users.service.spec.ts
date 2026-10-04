import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GcpStorageService } from '../gcp-storage/gcp-storage.service';
import { Prisma, User } from '../generated/prisma/client';
import { SecurityEventLogger } from '../observability/security-event.logger';
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
    emailVerified: false,
    image: null,
    role: 'user',
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockPrismaService = {
  user: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  recording: { findMany: jest.Mock; deleteMany: jest.Mock };
  practiceSessionTask: { deleteMany: jest.Mock };
  practiceSession: { deleteMany: jest.Mock };
  routineTask: { deleteMany: jest.Mock };
  routine: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
};

type MockSecurityEventLogger = { log: jest.Mock };

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrismaService;
  let securityEventLogger: MockSecurityEventLogger;
  let gcpStorage: { deleteObject: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      recording: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      practiceSessionTask: { deleteMany: jest.fn() },
      practiceSession: { deleteMany: jest.fn() },
      routineTask: { deleteMany: jest.fn() },
      routine: { deleteMany: jest.fn() },
      // The interactive transaction runs against the same mock client.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    securityEventLogger = { log: jest.fn() };
    gcpStorage = { deleteObject: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SecurityEventLogger,
          useValue: securityEventLogger,
        },
        { provide: GcpStorageService, useValue: gcpStorage },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
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
    it('deletes the user after everything they own, children first', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(
        service.remove('admin-id', 'some-id'),
      ).resolves.toBeUndefined();

      const order = [
        prisma.recording.deleteMany,
        prisma.practiceSessionTask.deleteMany,
        prisma.practiceSession.deleteMany,
        prisma.routineTask.deleteMany,
        prisma.routine.deleteMany,
        prisma.user.delete,
      ].map((m) => m.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(prisma.recording.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'some-id' },
      });
      expect(prisma.practiceSessionTask.deleteMany).toHaveBeenCalledWith({
        where: { practiceSession: { userId: 'some-id' } },
      });
      expect(prisma.routineTask.deleteMany).toHaveBeenCalledWith({
        where: { routine: { userId: 'some-id' } },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'some-id' },
      });
    });

    it('logs a user.deleted audit event with the actor and target on success', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await service.remove('admin-id', 'some-id');

      expect(securityEventLogger.log).toHaveBeenCalledWith({
        eventType: 'user.deleted',
        outcome: 'success',
        actorId: 'admin-id',
        targetType: 'user',
        targetId: 'some-id',
      });
    });

    it('throws NotFoundException for an unknown id and deletes nothing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.remove('admin-id', 'unknown-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.recording.deleteMany).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(securityEventLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('deletes every recording object after the rows are gone', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      const names = Array.from({ length: 7 }, (_, i) => `users/u/obj-${i}`);
      prisma.recording.findMany.mockResolvedValue(
        names.map((objectName) => ({ objectName })),
      );

      await service.deleteAccount('u');

      expect(
        (gcpStorage.deleteObject.mock.calls as [string][]).map(
          ([name]) => name,
        ),
      ).toEqual(names);
      expect(
        gcpStorage.deleteObject.mock.invocationCallOrder[0],
      ).toBeGreaterThan(prisma.user.delete.mock.invocationCallOrder[0]);
    });

    it('still succeeds and audits when a storage delete fails', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.recording.findMany.mockResolvedValue([
        { objectName: 'users/u/a' },
        { objectName: 'users/u/b' },
      ]);
      gcpStorage.deleteObject
        .mockRejectedValueOnce(new Error('gcs down'))
        .mockResolvedValueOnce(undefined);

      await expect(service.deleteAccount('u')).resolves.toBeUndefined();

      expect(gcpStorage.deleteObject).toHaveBeenCalledTimes(2);
      expect(securityEventLogger.log).toHaveBeenCalledWith({
        eventType: 'user.self_deleted',
        outcome: 'success',
        actorId: 'u',
        targetType: 'user',
        targetId: 'u',
      });
    });

    it('touches no storage when the transaction fails', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.recording.findMany.mockResolvedValue([{ objectName: 'x' }]);
      prisma.user.delete.mockRejectedValue(new Error('db down'));

      await expect(service.deleteAccount('u')).rejects.toThrow('db down');
      expect(gcpStorage.deleteObject).not.toHaveBeenCalled();
      expect(securityEventLogger.log).not.toHaveBeenCalled();
    });
  });
});
