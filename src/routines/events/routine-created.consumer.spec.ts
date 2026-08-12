import { Logger } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { meters } from '../../observability/metrics/meters';
import { RequestContext } from '../../observability/request-context';
import { ROUTINE_CREATED_PATTERN } from './routine-created.event';
import { RoutineCreatedConsumer } from './routine-created.consumer';
import { RoutineCreatedEvent } from './routine-created.event';

const EVENT: RoutineCreatedEvent = {
  eventId: 'a3f1c2d4-3333-4b2a-9c3d-000000000000',
  eventType: 'routine.created',
  eventVersion: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  correlationId: 'a3f1c2d4-4444-4b2a-9c3d-000000000000',
  data: {
    routineId: 'a3f1c2d4-1111-4b2a-9c3d-000000000000',
    userId: 'a3f1c2d4-2222-4b2a-9c3d-000000000000',
    title: 'Daily warm-up',
    status: 'active',
  },
};

function buildContext(): {
  context: RmqContext;
  channel: { ack: jest.Mock; nack: jest.Mock };
  message: { fields: Record<string, unknown> };
} {
  const channel = { ack: jest.fn(), nack: jest.fn() };
  const message = { fields: { deliveryTag: 1 } };
  const context = {
    getChannelRef: () => channel,
    getMessage: () => message,
  } as unknown as RmqContext;

  return { context, channel, message };
}

describe('RoutineCreatedConsumer', () => {
  let consumer: RoutineCreatedConsumer;

  beforeEach(() => {
    consumer = new RoutineCreatedConsumer();
  });

  // meters.* instruments are module-level singletons shared across tests in
  // this file — restore real implementations between tests so a spy from
  // one test can't leak call history into the next.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the received event and acks the message on success', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { context, channel, message } = buildContext();

    consumer.handleRoutineCreated(EVENT, context);

    expect(logSpy).toHaveBeenCalledWith(
      'routine.created event received',
      EVENT,
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('records a queueMessagesConsumedTotal metric on success', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const addSpy = jest.spyOn(meters.queueMessagesConsumedTotal, 'add');
    const { context } = buildContext();

    consumer.handleRoutineCreated(EVENT, context);

    expect(addSpy).toHaveBeenCalledWith(1, {
      eventType: ROUTINE_CREATED_PATTERN,
    });
  });

  it('restores RequestContext with the correlationId from the envelope while processing', () => {
    let observedCorrelationId: string | undefined;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
      observedCorrelationId = RequestContext.getCorrelationId();
    });
    const { context } = buildContext();

    consumer.handleRoutineCreated(EVENT, context);

    expect(observedCorrelationId).toBe(EVENT.correlationId);
    // The ambient context must not leak past the call.
    expect(RequestContext.getCorrelationId()).toBeUndefined();
  });

  it('nacks without requeue and records failure/dead-letter metrics when the handler throws', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
      throw new Error('boom');
    });
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failuresSpy = jest.spyOn(meters.queueConsumerFailuresTotal, 'add');
    const deadLetteredSpy = jest.spyOn(meters.queueDeadLetteredTotal, 'add');
    const { context, channel, message } = buildContext();

    expect(() => consumer.handleRoutineCreated(EVENT, context)).not.toThrow();

    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to process routine.created event',
      expect.any(Error),
    );
    expect(failuresSpy).toHaveBeenCalledWith(1, {
      eventType: ROUTINE_CREATED_PATTERN,
    });
    expect(deadLetteredSpy).toHaveBeenCalledWith(1, {
      eventType: ROUTINE_CREATED_PATTERN,
    });
  });
});
