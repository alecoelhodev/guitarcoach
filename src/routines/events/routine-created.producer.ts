import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { Routine } from '../../generated/prisma/client';
import { ROUTINE_EVENTS_CLIENT } from './rabbitmq.constants';
import {
  ROUTINE_CREATED_PATTERN,
  RoutineCreatedEvent,
} from './routine-created.event';

@Injectable()
export class RoutineCreatedProducer {
  private readonly logger = new Logger(RoutineCreatedProducer.name);

  constructor(
    @Inject(ROUTINE_EVENTS_CLIENT) private readonly client: ClientProxy,
  ) {}

  // Fire-and-forget: routine creation must succeed independently of the
  // broker being reachable. emit() is a hot observable — it dispatches
  // immediately without needing a subscriber — but we still subscribe with
  // an error handler so a publish failure is logged instead of surfacing as
  // an unobserved RxJS error.
  publish(routine: Routine): void {
    const event: RoutineCreatedEvent = {
      eventId: randomUUID(),
      eventType: 'routine.created',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      data: {
        routineId: routine.id,
        userId: routine.userId,
        title: routine.title,
        status: routine.status,
      },
    };

    this.client.emit(ROUTINE_CREATED_PATTERN, event).subscribe({
      error: (error: Error) => {
        this.logger.error('Failed to publish routine.created event', error);
      },
    });
  }
}
