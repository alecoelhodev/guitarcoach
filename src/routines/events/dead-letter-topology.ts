import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';
import { EnvironmentVariables } from '../../config/env.validation';
import {
  ROUTINE_EVENTS_DEAD_LETTER_EXCHANGE,
  ROUTINE_EVENTS_DEAD_LETTER_QUEUE,
} from './rabbitmq.constants';

/**
 * Declares the dead-letter exchange/queue/binding that
 * `ROUTINE_EVENTS_QUEUE_OPTIONS`'s `x-dead-letter-exchange` argument routes
 * to. Neither the producer's `ClientRMQ` nor the consumer's `ServerRMQ` (see
 * @nestjs/microservices' server-rmq.ts/client-rmq.ts) assert anything beyond
 * the main queue itself, so without this, a nacked message would route to a
 * non-existent exchange and RabbitMQ would drop it silently — defeating the
 * whole point of the DLQ. Uses a short-lived amqplib connection (distinct
 * from the amqp-connection-manager–backed client/consumer channels) purely
 * to assert topology once at startup, then closes it.
 */
export async function assertRoutineEventsDeadLetterTopology(
  url: string,
): Promise<void> {
  const connection = await amqplib.connect(url);
  try {
    const channel = await connection.createChannel();
    try {
      // Fanout: the DLX has exactly one consumer (the DLQ) and dead-lettered
      // messages should reach it regardless of routing key.
      await channel.assertExchange(
        ROUTINE_EVENTS_DEAD_LETTER_EXCHANGE,
        'fanout',
        {
          durable: true,
        },
      );
      await channel.assertQueue(ROUTINE_EVENTS_DEAD_LETTER_QUEUE, {
        durable: true,
      });
      await channel.bindQueue(
        ROUTINE_EVENTS_DEAD_LETTER_QUEUE,
        ROUTINE_EVENTS_DEAD_LETTER_EXCHANGE,
        '',
      );
    } finally {
      await channel.close();
    }
  } finally {
    await connection.close();
  }
}

/**
 * Runs `assertRoutineEventsDeadLetterTopology` once during Nest's module
 * initialization phase, before `main.ts` calls
 * `app.startAllMicroservices()` — so the DLX/DLQ exist before the consumer's
 * `ServerRMQ` asserts the main queue with its `x-dead-letter-exchange`
 * argument. A failure here is logged, not thrown: it must not block app
 * bootstrap (the main broker connection has its own independent
 * reconnect-with-backoff via amqp-connection-manager), but until it
 * succeeds, nacked messages will be dropped instead of dead-lettered.
 */
@Injectable()
export class RoutineEventsDeadLetterTopologyInitializer implements OnModuleInit {
  private readonly logger = new Logger(
    RoutineEventsDeadLetterTopologyInitializer.name,
  );

  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await assertRoutineEventsDeadLetterTopology(
        this.configService.get('RABBITMQ_URL', { infer: true }),
      );
    } catch (error) {
      this.logger.error(
        'Failed to assert routine.created dead-letter topology',
        error,
      );
    }
  }
}
