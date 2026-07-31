import { Logger } from '@nestjs/common';
import { RoutineCreatedConsumer } from './routine-created.consumer';
import { RoutineCreatedEvent } from './routine-created.event';

describe('RoutineCreatedConsumer', () => {
  it('logs the received event', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const consumer = new RoutineCreatedConsumer();
    const event: RoutineCreatedEvent = {
      eventId: 'a3f1c2d4-3333-4b2a-9c3d-000000000000',
      eventType: 'routine.created',
      eventVersion: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      data: {
        routineId: 'a3f1c2d4-1111-4b2a-9c3d-000000000000',
        userId: 'a3f1c2d4-2222-4b2a-9c3d-000000000000',
        title: 'Daily warm-up',
        status: 'active',
      },
    };

    consumer.handleRoutineCreated(event);

    expect(logSpy).toHaveBeenCalledWith(
      'routine.created event received',
      event,
    );
  });
});
