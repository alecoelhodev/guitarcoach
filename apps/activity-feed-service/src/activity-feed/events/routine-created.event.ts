// Own copy of the event contract published by the main API
// (apps/guitar-coach/src/routines/events/routine-created.event.ts). There is
// no shared library in this monorepo, so the shape is duplicated here
// deliberately rather than imported cross-app.
export interface RoutineCreatedEvent {
  eventId: string;
  eventType: 'routine.created';
  eventVersion: 1;
  occurredAt: string; // ISO string
  data: {
    routineId: string;
    userId: string;
    title: string;
    status: 'active' | 'archived';
  };
}
