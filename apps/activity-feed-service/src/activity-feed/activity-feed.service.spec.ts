import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { ActivityFeedService } from './activity-feed.service';
import { RoutineCreatedEvent } from './events/routine-created.event';
import { ActivityFeedEntry } from './schemas/activity-feed-entry.schema';

function buildEvent(
  overrides: Partial<RoutineCreatedEvent['data']> = {},
): RoutineCreatedEvent {
  return {
    eventId: 'evt-1',
    eventType: 'routine.created',
    eventVersion: 1,
    occurredAt: '2026-01-01T00:00:00.000Z',
    data: {
      routineId: 'routine-1',
      userId: 'user-1',
      title: 'Daily warm-up',
      status: 'active',
      ...overrides,
    },
  };
}

describe('ActivityFeedService', () => {
  let service: ActivityFeedService;
  let model: jest.Mocked<Model<ActivityFeedEntry>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityFeedService,
        {
          provide: getModelToken(ActivityFeedEntry.name),
          useValue: {
            create: jest.fn(),
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ActivityFeedService);
    model = module.get(getModelToken(ActivityFeedEntry.name));
  });

  describe('recordRoutineCreated', () => {
    it('persists an activity feed entry mapped from the event', async () => {
      model.create.mockResolvedValueOnce(undefined as never);

      await service.recordRoutineCreated(buildEvent());

      // eslint-disable-next-line @typescript-eslint/unbound-method -- reflecting on the mocked method reference, not calling it
      expect(model.create).toHaveBeenCalledWith({
        eventId: 'evt-1',
        eventType: 'routine.created',
        userId: 'user-1',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        data: {
          routineId: 'routine-1',
          title: 'Daily warm-up',
          status: 'active',
        },
      });
    });

    it('swallows a duplicate-key error instead of throwing', async () => {
      const duplicateKeyError = Object.assign(new Error('duplicate'), {
        code: 11000,
      });
      model.create.mockRejectedValueOnce(duplicateKeyError);

      await expect(
        service.recordRoutineCreated(buildEvent()),
      ).resolves.toBeUndefined();
    });

    it('rethrows non-duplicate-key errors', async () => {
      const otherError = new Error('connection lost');
      model.create.mockRejectedValueOnce(otherError);

      await expect(service.recordRoutineCreated(buildEvent())).rejects.toBe(
        otherError,
      );
    });
  });

  describe('findByUser', () => {
    it('queries by userId, sorts by occurredAt descending, and limits to 50', async () => {
      const query = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      model.find.mockReturnValue(query as never);

      await service.findByUser('user-1');

      // eslint-disable-next-line @typescript-eslint/unbound-method -- reflecting on the mocked method reference, not calling it
      expect(model.find).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(query.sort).toHaveBeenCalledWith({ occurredAt: -1 });
      expect(query.limit).toHaveBeenCalledWith(50);
      expect(query.exec).toHaveBeenCalled();
    });
  });
});
