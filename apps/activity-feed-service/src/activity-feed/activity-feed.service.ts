import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RoutineCreatedEvent } from './events/routine-created.event';
import { ActivityFeedEntry } from './schemas/activity-feed-entry.schema';

// MongoDB's error code for a unique-index violation.
const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

@Injectable()
export class ActivityFeedService {
  private readonly logger = new Logger(ActivityFeedService.name);

  constructor(
    @InjectModel(ActivityFeedEntry.name)
    private readonly activityFeedEntryModel: Model<ActivityFeedEntry>,
  ) {}

  async recordRoutineCreated(event: RoutineCreatedEvent): Promise<void> {
    try {
      await this.activityFeedEntryModel.create({
        eventId: event.eventId,
        eventType: event.eventType,
        userId: event.data.userId,
        occurredAt: new Date(event.occurredAt),
        data: {
          routineId: event.data.routineId,
          title: event.data.title,
          status: event.data.status,
        },
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        // Idempotent by design: RabbitMQ may redeliver `routine.created`,
        // and the unique `eventId` index rejects the repeat insert. Swallow
        // it rather than throwing back into the RMQ event handler.
        this.logger.warn(
          `Ignored duplicate routine.created event (eventId=${event.eventId})`,
        );
        return;
      }
      throw error;
    }
  }

  async findByUser(userId: string): Promise<ActivityFeedEntry[]> {
    return this.activityFeedEntryModel
      .find({ userId })
      .sort({ occurredAt: -1 })
      .limit(50)
      .lean<ActivityFeedEntry[]>()
      .exec();
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === MONGO_DUPLICATE_KEY_ERROR_CODE
    );
  }
}
