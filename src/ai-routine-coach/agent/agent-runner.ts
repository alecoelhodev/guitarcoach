import { Injectable, Logger } from '@nestjs/common';
import { Agent, run, RunResult, withTrace } from '@openai/agents';
import { meters } from '../../observability/metrics/meters';
import { RoutineCoachContext } from './routine-coach.context';

export const AGENT_RUNNER = 'AGENT_RUNNER';

const AI_PROVIDER_NAME = 'routine-coach-agent';

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
  private readonly logger = new Logger(DefaultAgentRunner.name);

  async run(
    agent: Agent<RoutineCoachContext>,
    input: string,
    options: AgentRunOptions,
  ): Promise<RunResult<RoutineCoachContext, Agent<RoutineCoachContext>>> {
    const startedAt = Date.now();
    try {
      const result = await withTrace('RoutineCoachAgent', () =>
        run(agent, input, options),
      );
      const durationMs = Date.now() - startedAt;
      // RunState.usage is the only turn-count-adjacent signal a *non*-
      // streaming RunResult publicly exposes -- currentTurn only exists on
      // StreamedRunResult (this runner never streams), and RunState's own
      // `_currentTurn` is an internal field the SDK's own docs say not to
      // read directly. Deliberate gap: no per-run turn count is recorded
      // here; the max-turns *exceeded* case is still covered via
      // meters.aiMaxTurnsTotal in AiRoutineCoachService's error translation.
      const usage = result.state.usage;

      meters.aiRequestsTotal.add(1, {
        provider: AI_PROVIDER_NAME,
        outcome: 'success',
      });
      meters.aiRequestDurationMs.record(durationMs, {
        provider: AI_PROVIDER_NAME,
      });
      meters.aiTokensTotal.add(usage.inputTokens, {
        provider: AI_PROVIDER_NAME,
        kind: 'input',
      });
      meters.aiTokensTotal.add(usage.outputTokens, {
        provider: AI_PROVIDER_NAME,
        kind: 'output',
      });
      meters.aiTokensTotal.add(usage.totalTokens, {
        provider: AI_PROVIDER_NAME,
        kind: 'total',
      });

      this.logger.log('RoutineCoachAgent run completed', {
        durationMs,
        requests: usage.requests,
        tokensInput: usage.inputTokens,
        tokensOutput: usage.outputTokens,
        tokensTotal: usage.totalTokens,
        outcome: 'success',
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      meters.aiRequestsTotal.add(1, {
        provider: AI_PROVIDER_NAME,
        outcome: 'error',
      });
      meters.aiRequestDurationMs.record(durationMs, {
        provider: AI_PROVIDER_NAME,
      });
      this.logger.log('RoutineCoachAgent run completed', {
        durationMs,
        outcome: 'error',
      });
      throw error;
    }
  }
}
