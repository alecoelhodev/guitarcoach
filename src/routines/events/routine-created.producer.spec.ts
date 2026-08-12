import { Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { Routine } from '../../generated/prisma/client';
import { meters } from '../../observability/metrics/meters';
import { RequestContext } from '../../observability/request-context';
import { ROUTINE_CREATED_PATTERN } from './routine-created.event';
import { RoutineCreatedProducer } from './routine-created.producer';

const ROUTINE: Routine = {
  id: 'a3f1c2d4-1111-4b2a-9c3d-000000000000',
  userId: 'a3f1c2d4-2222-4b2a-9c3d-000000000000',
  title: 'Daily warm-up',
  status: 'active',
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('RoutineCreatedProducer', () => {
  let producer: RoutineCreatedProducer;
  let client: { emit: jest.Mock };

  beforeEach(() => {
    client = { emit: jest.fn().mockReturnValue(of(undefined)) };
    producer = new RoutineCreatedProducer(client as unknown as ClientProxy);
  });

  // meters.* instruments are module-level singletons shared across tests in
  // this file, so a spy left in place from one test would keep accumulating
  // calls in the next — restore real implementations between tests.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits the event with the routine.created pattern and trimmed payload', () => {
    producer.publish(ROUTINE);

    expect(client.emit).toHaveBeenCalledWith(
      ROUTINE_CREATED_PATTERN,
      expect.objectContaining({
        eventType: 'routine.created',
        eventVersion: 1,
        data: {
          routineId: ROUTINE.id,
          userId: ROUTINE.userId,
          title: ROUTINE.title,
          status: ROUTINE.status,
        },
      }),
    );
  });

  it('logs an error instead of throwing when the emit observable errors', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    client.emit.mockReturnValue(throwError(() => new Error('broker down')));

    expect(() => producer.publish(ROUTINE)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to publish routine.created event',
      expect.any(Error),
    );
  });

  it('propagates the ambient correlationId into the published envelope', () => {
    RequestContext.run(
      { requestId: 'request-1', correlationId: 'correlation-1' },
      () => producer.publish(ROUTINE),
    );

    expect(client.emit).toHaveBeenCalledWith(
      ROUTINE_CREATED_PATTERN,
      expect.objectContaining({ correlationId: 'correlation-1' }),
    );
  });

  it('generates a fresh correlationId when published outside a RequestContext', () => {
    producer.publish(ROUTINE);

    const [, event] = client.emit.mock.calls[0] as [
      string,
      { correlationId: string },
    ];
    expect(typeof event.correlationId).toBe('string');
    expect(event.correlationId.length).toBeGreaterThan(0);
  });

  it('records a queueMessagesPublishedTotal metric on successful emit', () => {
    const addSpy = jest.spyOn(meters.queueMessagesPublishedTotal, 'add');

    producer.publish(ROUTINE);

    expect(addSpy).toHaveBeenCalledWith(1, {
      eventType: ROUTINE_CREATED_PATTERN,
    });
  });

  it('does not record a queueMessagesPublishedTotal metric when emit errors', () => {
    const addSpy = jest.spyOn(meters.queueMessagesPublishedTotal, 'add');
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    client.emit.mockReturnValue(throwError(() => new Error('broker down')));

    producer.publish(ROUTINE);

    expect(addSpy).not.toHaveBeenCalled();
  });
});
