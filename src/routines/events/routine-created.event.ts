import { RoutineStatus } from '../../generated/prisma/enums';

export const ROUTINE_CREATED_PATTERN = 'routine.created';

export interface RoutineCreatedEvent {
  eventId: string;
  eventType: 'routine.created';
  eventVersion: 1;
  occurredAt: string;
  /**
   * Ties this message back to the HTTP request that triggered it, so the
   * consumer can restore `RequestContext` and every log line during
   * processing correlates to the originating request.
   */
  correlationId: string;
  data: {
    routineId: string;
    userId: string;
    title: string;
    status: RoutineStatus;
  };
}
