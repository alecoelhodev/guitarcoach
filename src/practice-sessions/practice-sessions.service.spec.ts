import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PracticeSession } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeSessionsService } from './practice-sessions.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const SESSION_ID = 'a3f1c2d4-1111-4b2a-9c3d-000000000000';

function buildPracticeSession(
  overrides: Partial<PracticeSession> = {},
): PracticeSession {
  return {
    id: SESSION_ID,
    userId: USER_ID,
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
  };
};

describe('PracticeSessionsService', () => {
  let service: PracticeSessionsService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = {
      practiceSession: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeSessionsService,
        { provide: PrismaService, useValue: prisma },
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
        data: { title: 'Morning warm-up', userId: USER_ID },
      });
      expect(session).toEqual(created);
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
});
