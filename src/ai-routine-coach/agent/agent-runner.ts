import { Injectable } from '@nestjs/common';
import { Agent, run, RunResult, withTrace } from '@openai/agents';
import { RoutineCoachContext } from './routine-coach.context';

export const AGENT_RUNNER = 'AGENT_RUNNER';

export interface AgentRunOptions {
  context: RoutineCoachContext;
  maxTurns: number;
}

// Thin seam around the SDK's run()/withTrace() free functions -- mirrors the
// AI_PROVIDER DI-token pattern used by ai-practice-planner, so unit tests can
// hand-build a fake runner instead of reaching for module-level mocking of
// @openai/agents.
export interface AgentRunner {
  run(
    agent: Agent<RoutineCoachContext>,
    input: string,
    options: AgentRunOptions,
  ): Promise<RunResult<RoutineCoachContext, Agent<RoutineCoachContext>>>;
}

@Injectable()
export class DefaultAgentRunner implements AgentRunner {
  run(
    agent: Agent<RoutineCoachContext>,
    input: string,
    options: AgentRunOptions,
  ): Promise<RunResult<RoutineCoachContext, Agent<RoutineCoachContext>>> {
    return withTrace('RoutineCoachAgent', () => run(agent, input, options));
  }
}
