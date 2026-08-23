import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  InputGuardrailTripwireTriggered,
  MaxTurnsExceededError,
  ModelBehaviorError,
  ToolCallError,
} from '@openai/agents';
import OpenAI from 'openai';
import { meters } from '../observability/metrics/meters';
import { AGENT_RUNNER } from './agent/agent-runner';
import type { AgentRunner } from './agent/agent-runner';
import { RoutineCoachContext } from './agent/routine-coach.context';
import { RoutineCoachAgentFactory } from './agent/routine-coach-agent.factory';
import { RoutineCoachResponseDto } from './dto/routine-coach-response.dto';
import { ROUTINE_COACH_MAX_TURNS } from './tools/tool-constants';

@Injectable()
export class AiRoutineCoachService {
  private readonly logger = new Logger(AiRoutineCoachService.name);

  constructor(
    private readonly agentFactory: RoutineCoachAgentFactory,
    @Inject(AGENT_RUNNER) private readonly agentRunner: AgentRunner,
  ) {}

  async handleRequest(
    userId: string,
    message: string,
  ): Promise<RoutineCoachResponseDto> {
    const agent = this.agentFactory.getAgent();
    const context: RoutineCoachContext = { userId };

    this.logger.log('RoutineCoachAgent started');

    let result: Awaited<ReturnType<AgentRunner['run']>>;
    try {
      result = await this.agentRunner.run(agent, message, {
        context,
        maxTurns: ROUTINE_COACH_MAX_TURNS,
      });
    } catch (error) {
      throw this.translateAgentError(error);
    }

    this.logger.log(
      `agent completed; routineCreated=${Boolean(context.createdRoutine)}`,
    );

    return {
      message: result.finalOutput ?? '',
      routineId: context.createdRoutine?.routineId,
      routineTitle: context.createdRoutine?.title,
      taskCount: context.createdRoutine?.taskCount,
    };
  }

  private translateAgentError(error: unknown): Error {
    if (error instanceof InputGuardrailTripwireTriggered) {
      this.logger.warn('guardrail triggered');
      return new BadRequestException(
        'This request is outside what the Routine Coach can help with.',
      );
    }

    if (error instanceof MaxTurnsExceededError) {
      this.logger.warn('max turns exceeded');
      meters.aiMaxTurnsTotal.add(1);
      return new BadGatewayException(
        'The routine coach could not complete this request in a reasonable number of steps.',
      );
    }

    // Covers the SDK's InvalidToolInputError (model-produced tool-call
    // arguments failed the SDK's own schema validation before execute() ever
    // ran, the spec's "invalid tool arguments" case) and other malformed
    // model behavior -- ModelBehaviorError is InvalidToolInputError's base
    // class and the narrower type isn't part of this SDK version's public
    // exports.
    if (error instanceof ModelBehaviorError) {
      this.logger.warn(`model behavior error: ${error.message}`);
      return new BadRequestException(
        'The routine coach could not understand how to use one of its tools for this request.',
      );
    }

    // A tool's execute() threw something its own known-error handling
    // didn't catch (e.g. an unexpected PracticeSession/Routine persistence
    // failure) -- the spec's "tool execution failure" case. The underlying
    // cause is logged server-side only; never surfaced to the client.
    if (error instanceof ToolCallError) {
      this.logger.warn(`tool execution failed: ${error.error.message}`);
      return new BadGatewayException(
        'A tool used by the routine coach failed unexpectedly.',
      );
    }

    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return new GatewayTimeoutException('OpenAI request timed out');
    }

    if (
      error instanceof OpenAI.RateLimitError ||
      error instanceof OpenAI.InternalServerError
    ) {
      return new ServiceUnavailableException(
        'Routine Coach is temporarily unavailable',
      );
    }

    // Covers APIConnectionError and any other APIError subclass not handled
    // above -- all extend APIError, so this is the safe fallback for the
    // rest of the hierarchy (mirrors AiPracticePlannerService.callAiProvider).
    if (error instanceof OpenAI.APIError) {
      return new ServiceUnavailableException(
        'Routine Coach is temporarily unavailable',
      );
    }

    return error as Error;
  }
}
