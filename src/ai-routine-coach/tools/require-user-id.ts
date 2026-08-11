import type { RunContext } from '@openai/agents';
import { RoutineCoachContext } from '../agent/routine-coach.context';

// Single choke point proving no tool ever reads a model-supplied userId --
// none of the tool Zod schemas declare a `userId` field at all. The
// authenticated user always comes from the SDK's local RunContext, set once
// by AiRoutineCoachService from the session, never from tool arguments.
export function requireUserId(
  runContext?: RunContext<RoutineCoachContext>,
): string {
  const userId = runContext?.context.userId;
  if (!userId) {
    throw new Error(
      'RoutineCoach tool invoked without an authenticated user in context',
    );
  }
  return userId;
}
