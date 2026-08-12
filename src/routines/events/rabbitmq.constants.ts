import { RmqOptions, Transport } from '@nestjs/microservices';

export const ROUTINE_EVENTS_CLIENT = 'ROUTINE_EVENTS_CLIENT';
export const ROUTINE_EVENTS_QUEUE = 'routine_events';

// Dead-letter topology: messages nacked without requeue (see
// RoutineCreatedConsumer) are routed here by RabbitMQ via the main queue's
// `x-dead-letter-exchange` argument below, instead of being silently
// dropped. The exchange/queue/binding aren't created implicitly by that
// argument — something must assert them explicitly, which
// `assertRoutineEventsDeadLetterTopology` (dead-letter-topology.ts) does at
// startup.
export const ROUTINE_EVENTS_DEAD_LETTER_EXCHANGE = 'routine_events.dlx';
export const ROUTINE_EVENTS_DEAD_LETTER_QUEUE = 'routine_events.dlq';

// Shared between the producer's client registration (routines.module.ts) and
// the consumer's microservice registration (main.ts) — RabbitMQ rejects a
// queue redeclare whose options don't match the first declaration, so both
// sides must reference the same object rather than two literals that could
// drift apart.
//
// NOTE: changing `queueOptions.arguments` on an already-declared durable
// queue requires deleting and recreating `routine_events` in any environment
// where it was declared before this change (RabbitMQ rejects a redeclare
// with mismatched arguments with a 406 PRECONDITION_FAILED channel error).
export const ROUTINE_EVENTS_QUEUE_OPTIONS: RmqOptions['options'] = {
  queue: ROUTINE_EVENTS_QUEUE,
  queueOptions: {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': ROUTINE_EVENTS_DEAD_LETTER_EXCHANGE,
    },
  },
  // Manual ack (see RoutineCreatedConsumer): a handler failure nacks
  // without requeue instead of the message being auto-dequeued and lost.
  noAck: false,
};

export function routineEventsRmqOptions(url: string): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      ...ROUTINE_EVENTS_QUEUE_OPTIONS,
    },
  };
}
