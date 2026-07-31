import { RoutineStatus } from '../../generated/prisma/enums';

export const ROUTINE_CREATED_PATTERN = 'routine.created';

export interface RoutineCreatedEvent {
  eventId: string;
  eventType: 'routine.created';
  eventVersion: 1;
  occurredAt: string;
  data: {
    routineId: string;
    userId: string;
    title: string;
    status: RoutineStatus;
  };
}
