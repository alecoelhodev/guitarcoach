export const DEFAULT_LOOKBACK_DAYS = 14;
export const MIN_LOOKBACK_DAYS = 1;
export const MAX_LOOKBACK_DAYS = 90;

export const MAX_TASK_DURATION_MINUTES = 120;
export const MAX_TOTAL_ROUTINE_DURATION_MINUTES = 240;
export const MAX_TASKS_PER_ROUTINE = 20;

// Conceptual flow is at most 4 read tools + 1 write tool (~5 tool-calling
// turns) plus reasoning/final-text turns -- 8 gives headroom for a re-check
// without allowing an unbounded loop.
export const ROUTINE_COACH_MAX_TURNS = 8;
