import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import type { Channel, Message } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { meters } from '../../observability/metrics/meters';
import { RequestContext } from '../../observability/request-context';
import { ROUTINE_CREATED_PATTERN } from './routine-created.event';
import type { RoutineCreatedEvent } from './routine-created.event';

@Controller()
export class RoutineCreatedConsumer {
  private readonly logger = new Logger(RoutineCreatedConsumer.name);

  @EventPattern(ROUTINE_CREATED_PATTERN)
  handleRoutineCreated(
    @Payload() event: RoutineCreatedEvent,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef() as Channel;
    const originalMessage = context.getMessage() as Message;

    // requestId is fresh per delivery attempt; correlationId is restored
    // from the envelope so every log line during processing correlates back
    // to the HTTP request that published this event.
    RequestContext.run(
      { requestId: randomUUID(), correlationId: event.correlationId },
      () => {
        try {
          // Placeholder for future side effects triggered by routine
          // creation — today this just logs, per the existing convention.
          this.logger.log('routine.created event received', event);

          channel.ack(originalMessage);
          meters.queueMessagesConsumedTotal.add(1, {
            eventType: ROUTINE_CREATED_PATTERN,
          });
        } catch (error) {
          this.logger.error('Failed to process routine.created event', error);
          meters.queueConsumerFailuresTotal.add(1, {
            eventType: ROUTINE_CREATED_PATTERN,
          });

          // No requeue: RabbitMQ routes the message to the dead-letter
          // exchange configured on the queue (see rabbitmq.constants.ts)
          // rather than retrying forever or dropping it silently. With that
          // DLX argument in place, this nack always results in
          // dead-lettering, so it's safe to count it unconditionally.
          channel.nack(originalMessage, false, false);
          meters.queueDeadLetteredTotal.add(1, {
            eventType: ROUTINE_CREATED_PATTERN,
          });
        }
      },
    );
  }
}
