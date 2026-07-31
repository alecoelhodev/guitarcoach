import { RmqOptions, Transport } from '@nestjs/microservices';

export const ROUTINE_EVENTS_CLIENT = 'ROUTINE_EVENTS_CLIENT';
export const ROUTINE_EVENTS_QUEUE = 'routine_events';

// Shared between the producer's client registration (routines.module.ts) and
// the consumer's microservice registration (main.ts) — RabbitMQ rejects a
// queue redeclare whose options don't match the first declaration, so both
// sides must reference the same object rather than two literals that could
// drift apart.
export const ROUTINE_EVENTS_QUEUE_OPTIONS: RmqOptions['options'] = {
  queue: ROUTINE_EVENTS_QUEUE,
  queueOptions: { durable: true },
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
