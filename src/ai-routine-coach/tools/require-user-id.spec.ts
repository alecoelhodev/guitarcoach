import type { RunContext } from '@openai/agents';
import { requireUserId } from './require-user-id';
import { RoutineCoachContext } from '../agent/routine-coach.context';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';

describe('requireUserId', () => {
  it('returns the userId from a present RunContext', () => {
    const runContext = {
      context: { userId: USER_ID },
    } as RunContext<RoutineCoachContext>;

    expect(requireUserId(runContext)).toBe(USER_ID);
  });

  it('throws when the RunContext is missing entirely', () => {
    expect(() => requireUserId(undefined)).toThrow(
      'RoutineCoach tool invoked without an authenticated user in context',
    );
  });

  it('throws when the context has no userId', () => {
    const runContext = {
      context: {},
    } as unknown as RunContext<RoutineCoachContext>;

    expect(() => requireUserId(runContext)).toThrow(
      'RoutineCoach tool invoked without an authenticated user in context',
    );
  });
});
