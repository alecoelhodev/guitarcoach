import { RmqOptions, Transport } from '@nestjs/microservices';

export const ACTIVITY_FEED_CLIENT = 'ACTIVITY_FEED_CLIENT';
export const ACTIVITY_FEED_QUEUE = 'activity_feed_queue';
export const ACTIVITY_FEED_GET_BY_USER_PATTERN = 'activity-feed.get-by-user';

// Shared between this client's registration (activity-feed.module.ts, reused
// by routines.module.ts for the routine.created producer) and the external
// ActivityFeedService's own queue declaration — RabbitMQ rejects a queue
// redeclare whose options don't match the first declaration, so anything
// referencing this queue must share the same options object rather than two
// literals that could drift apart. The queue carries both the
// routine.created event (@EventPattern) and the activity-feed.get-by-user
// RPC query (@MessagePattern) on the consumer side.
export const ACTIVITY_FEED_QUEUE_OPTIONS: RmqOptions['options'] = {
  queue: ACTIVITY_FEED_QUEUE,
  queueOptions: { durable: true },
};

export function activityFeedRmqOptions(url: string): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      ...ACTIVITY_FEED_QUEUE_OPTIONS,
    },
  };
}
