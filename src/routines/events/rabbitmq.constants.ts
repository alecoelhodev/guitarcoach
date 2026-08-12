import { RmqOptions, Transport } from '@nestjs/microservices';

export const ROUTINE_EVENTS_CLIENT = 'ROUTINE_EVENTS_CLIENT';
// Renamed from 'routine_events': that name was already declared in
// production without the `x-dead-letter-exchange` argument below, and
// RabbitMQ rejects a redeclare whose arguments changed (406
// PRECONDITION_FAILED). Deleting the old queue by hand doesn't work either —
// while the previous revision is still serving traffic, every fresh instance
// it autoscales just re-declares 'routine_events' with the old arguments
// again within seconds, racing any manual deletion. A new queue name sidesteps
// the conflict entirely instead of trying to win that race. The orphaned
// 'routine_events' queue can be deleted once no revision referencing it is
// still running.
export const ROUTINE_EVENTS_QUEUE = 'routine_events_v2';

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
// NOTE: any future change to `queueOptions.arguments` on this queue needs a
// new queue name again, for the same reason `ROUTINE_EVENTS_QUEUE` was
// renamed above — see that comment.
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
