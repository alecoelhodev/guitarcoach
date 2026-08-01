import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  ACTIVITY_FEED_GET_BY_USER_PATTERN,
  ROUTINE_CREATED_PATTERN,
} from './activity-feed.constants';
import { ActivityFeedService } from './activity-feed.service';
import type { RoutineCreatedEvent } from './events/routine-created.event';
import { ActivityFeedEntry } from './schemas/activity-feed-entry.schema';

interface GetByUserPayload {
  userId: string;
}

@Controller()
export class ActivityFeedController {
  constructor(private readonly activityFeedService: ActivityFeedService) {}

  @EventPattern(ROUTINE_CREATED_PATTERN)
  async handleRoutineCreated(
    @Payload() event: RoutineCreatedEvent,
  ): Promise<void> {
    await this.activityFeedService.recordRoutineCreated(event);
  }

  @MessagePattern(ACTIVITY_FEED_GET_BY_USER_PATTERN)
  async getByUser(
    @Payload() payload: GetByUserPayload,
  ): Promise<ActivityFeedEntry[]> {
    return this.activityFeedService.findByUser(payload.userId);
  }
}
