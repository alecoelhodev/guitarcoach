import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityFeedController } from './activity-feed.controller';
import { ActivityFeedService } from './activity-feed.service';
import {
  ActivityFeedEntry,
  ActivityFeedEntrySchema,
} from './schemas/activity-feed-entry.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ActivityFeedEntry.name, schema: ActivityFeedEntrySchema },
    ]),
  ],
  controllers: [ActivityFeedController],
  providers: [ActivityFeedService],
})
export class ActivityFeedModule {}
