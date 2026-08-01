import { Test, TestingModule } from '@nestjs/testing';
import { ActivityFeedController } from './activity-feed.controller';
import { ActivityFeedService } from './activity-feed.service';
import { RoutineCreatedEvent } from './events/routine-created.event';

describe('ActivityFeedController', () => {
  let controller: ActivityFeedController;
  let service: jest.Mocked<ActivityFeedService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivityFeedController],
      providers: [
        {
          provide: ActivityFeedService,
          useValue: {
            recordRoutineCreated: jest.fn(),
            findByUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ActivityFeedController);
    service = module.get(ActivityFeedService);
  });

  describe('handleRoutineCreated', () => {
    it('delegates to the service', async () => {
      const event: RoutineCreatedEvent = {
        eventId: 'evt-1',
        eventType: 'routine.created',
        eventVersion: 1,
        occurredAt: '2026-01-01T00:00:00.000Z',
        data: {
          routineId: 'routine-1',
          userId: 'user-1',
          title: 'Daily warm-up',
          status: 'active',
        },
      };

      await controller.handleRoutineCreated(event);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- reflecting on the mocked method reference, not calling it
      expect(service.recordRoutineCreated).toHaveBeenCalledWith(event);
    });
  });

  describe('getByUser', () => {
    it('delegates to the service and returns its result', async () => {
      const entries = [{ eventId: 'evt-1' }] as never;
      service.findByUser.mockResolvedValueOnce(entries);

      const result = await controller.getByUser({ userId: 'user-1' });

      // eslint-disable-next-line @typescript-eslint/unbound-method -- reflecting on the mocked method reference, not calling it
      expect(service.findByUser).toHaveBeenCalledWith('user-1');
      expect(result).toBe(entries);
    });
  });
});
