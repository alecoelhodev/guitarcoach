import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { Routine } from '../../generated/prisma/client';
import { meters } from '../../observability/metrics/meters';
import { RequestContext } from '../../observability/request-context';
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
    // Carries the originating HTTP request's correlation id through to the
    // consumer. Falls back to a fresh id only if publish is somehow called
    // outside any RequestContext scope — not the expected call path (today
    // it's always invoked from within the HTTP request that creates the
    // routine), so this is defensive rather than the common case.
    const correlationId = RequestContext.getCorrelationId() ?? randomUUID();

    const event: RoutineCreatedEvent = {
      eventId: randomUUID(),
      eventType: 'routine.created',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      correlationId,
      data: {
        routineId: routine.id,
        userId: routine.userId,
        title: routine.title,
        status: routine.status,
      },
    };

    this.client.emit(ROUTINE_CREATED_PATTERN, event).subscribe({
      next: () => {
        meters.queueMessagesPublishedTotal.add(1, {
          eventType: ROUTINE_CREATED_PATTERN,
        });
      },
      error: (error: Error) => {
        this.logger.error('Failed to publish routine.created event', error);
      },
    });
  }
}
