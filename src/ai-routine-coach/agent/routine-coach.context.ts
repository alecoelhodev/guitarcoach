export interface RoutineCoachCreatedRoutine {
  routineId: string;
  title: string;
  taskCount: number;
}

export interface RoutineCoachContext {
  userId: string;
  // Set only by create_routine's handler after RoutinesService actually
  // persisted the routine. The HTTP response's routineId is read from here,
  // never parsed out of the model's text -- this is what makes "never claim
  // success unless it actually happened" enforceable in code, not just in
  // the prompt.
  createdRoutine?: RoutineCoachCreatedRoutine;
}
