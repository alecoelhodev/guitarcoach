import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ActivityFeedEntryDocument = HydratedDocument<ActivityFeedEntry>;

@Schema({ _id: false })
export class ActivityFeedEntryData {
  @Prop({ required: true })
  routineId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  status: string;
}

const ActivityFeedEntryDataSchema = SchemaFactory.createForClass(
  ActivityFeedEntryData,
);

@Schema({ timestamps: true })
export class ActivityFeedEntry {
  // Unique index doubles as the idempotency guard against RabbitMQ
  // redelivery producing duplicate feed entries for the same event.
  @Prop({ required: true, unique: true })
  eventId: string;

  @Prop({ required: true })
  eventType: string;

  @Prop({ required: true, index: true })
  userId: string;

  // When the domain event occurred, distinct from createdAt/updatedAt below
  // (which record when this document was written/modified).
  @Prop({ required: true })
  occurredAt: Date;

  @Prop({ type: ActivityFeedEntryDataSchema, required: true })
  data: ActivityFeedEntryData;
}

export const ActivityFeedEntrySchema =
  SchemaFactory.createForClass(ActivityFeedEntry);

// Feed reads are always "latest activity for a given user".
ActivityFeedEntrySchema.index({ userId: 1, occurredAt: -1 });
