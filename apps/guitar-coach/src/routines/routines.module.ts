import { Module } from '@nestjs/common';
import { ActivityFeedModule } from '../activity-feed/activity-feed.module';
import { RoutineCreatedProducer } from './events/routine-created.producer';
import { RoutinesController } from './routines.controller';
import { RoutinesService } from './routines.service';

@Module({
  imports: [ActivityFeedModule],
  controllers: [RoutinesController],
  providers: [RoutinesService, RoutineCreatedProducer],
  exports: [RoutinesService],
})
export class RoutinesModule {}
