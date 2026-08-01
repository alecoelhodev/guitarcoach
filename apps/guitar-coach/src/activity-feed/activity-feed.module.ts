import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { EnvironmentVariables } from '../config/env.validation';
import { ActivityFeedController } from './activity-feed.controller';
import {
  ACTIVITY_FEED_CLIENT,
  activityFeedRmqOptions,
} from './activity-feed.constants';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: ACTIVITY_FEED_CLIENT,
        inject: [ConfigService],
        useFactory: (
          configService: ConfigService<EnvironmentVariables, true>,
        ) =>
          activityFeedRmqOptions(
            configService.get('RABBITMQ_URL', { infer: true }),
          ),
      },
    ]),
  ],
  controllers: [ActivityFeedController],
  // Re-exports ClientsModule so RoutinesModule can import ActivityFeedModule
  // and inject the SAME ACTIVITY_FEED_CLIENT for emitting routine.created,
  // rather than registering a second ClientsModule for the same queue.
  exports: [ClientsModule],
})
export class ActivityFeedModule {}
