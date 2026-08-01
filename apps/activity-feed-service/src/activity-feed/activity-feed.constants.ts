import { RmqOptions, Transport } from '@nestjs/microservices';

export const ACTIVITY_FEED_QUEUE = 'activity_feed_queue';
export const ROUTINE_CREATED_PATTERN = 'routine.created';
export const ACTIVITY_FEED_GET_BY_USER_PATTERN = 'activity-feed.get-by-user';

// Single shared queue-options object: RabbitMQ rejects redeclaring a queue
// with different options, so every place that declares this queue (today,
// only this microservice's own listener registration in main.ts) must
// reference the same object rather than a duplicated literal that could
// drift apart from it.
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
