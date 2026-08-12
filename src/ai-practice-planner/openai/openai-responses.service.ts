import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodResponsesFunction, zodTextFormat } from 'openai/helpers/zod';
import { EnvironmentVariables } from '../../config/env.validation';
import { meters } from '../../observability/metrics/meters';
import { PracticePlanSchema } from '../dto/practice-plan.schema';
import { CreateRoutineArgsSchema } from '../tools/create-routine.types';
import {
  AiProvider,
  ConfirmedRoutineCreation,
  CreateRoutineExecutor,
  GeneratedPracticePlan,
} from './ai-provider';
import { OPENAI_CLIENT } from './openai.constants';

const SYSTEM_INSTRUCTIONS =
  'You are a guitar practice planning assistant. Given a natural-language request, ' +
  'produce a structured practice plan with a title, short summary, an ordered list of ' +
  'tasks (each with a title, description, and durationMinutes), and a totalDurationMinutes ' +
  'that the task durations should reasonably add up to. Use web search only when it would ' +
  'materially improve the plan (e.g. researching an unfamiliar technique) -- it is not ' +
  'required for every request. Always set requiresConfirmation to true.';

const CONFIRMATION_PROMPT =
  'The user has confirmed this plan. Call create_routine now to persist it.';

const AI_PROVIDER_NAME = 'openai-responses';

// Structural (not imported) usage/status shape -- matches openai v7's
// `ResponseUsage`/`ResponseStatus` fields without depending on their exact
// deep import path (the package's `exports` map doesn't expose one).
interface ResponseObservabilityFields {
  status?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

function describeIncompleteResponse(response: {
  error?: unknown;
  incomplete_details?: unknown;
}): string {
  const detail = response.error ?? response.incomplete_details;
  if (detail && typeof detail === 'object') {
    const { message, type } = detail as { message?: unknown; type?: unknown };
    const typeText = typeof type === 'string' ? type : 'unknown';
    const messageText = typeof message === 'string' ? message : 'no message';
    if (typeof message === 'string' || typeof type === 'string') {
      return `${typeText}: ${messageText}`;
    }
  }
  return JSON.stringify(detail);
}

export function createOpenAiClient(
  configService: ConfigService<EnvironmentVariables, true>,
): OpenAI {
  return new OpenAI({
    apiKey: configService.get('OPENAI_API_KEY', { infer: true }),
    timeout: configService.get('OPENAI_REQUEST_TIMEOUT_MS', { infer: true }),
  });
}

@Injectable()
export class OpenAiResponsesService implements AiProvider {
  private readonly logger = new Logger(OpenAiResponsesService.name);
  private readonly model: string;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI,
    configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.model = configService.get('OPENAI_MODEL', { infer: true });
  }

  // Timing/metrics/logging wrapper around every `client.responses.parse()`
  // call site -- metadata only (durations, token counts, model name,
  // outcome), never the prompt/instructions/output content itself. Doesn't
  // change what's returned or thrown; callers keep their own
  // status/output_parsed checks unchanged.
  private async instrumentedParse<T extends ResponseObservabilityFields>(
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const response = await fn();
      const durationMs = Date.now() - startedAt;
      const outcome = response.status === 'completed' ? 'success' : 'error';

      meters.aiRequestsTotal.add(1, { provider: AI_PROVIDER_NAME, outcome });
      meters.aiRequestDurationMs.record(durationMs, {
        provider: AI_PROVIDER_NAME,
      });
      if (response.usage) {
        meters.aiTokensTotal.add(response.usage.input_tokens, {
          provider: AI_PROVIDER_NAME,
          kind: 'input',
        });
        meters.aiTokensTotal.add(response.usage.output_tokens, {
          provider: AI_PROVIDER_NAME,
          kind: 'output',
        });
        meters.aiTokensTotal.add(response.usage.total_tokens, {
          provider: AI_PROVIDER_NAME,
          kind: 'total',
        });
      }

      this.logger.log('OpenAI Responses API call completed', {
        durationMs,
        model: this.model,
        tokensInput: response.usage?.input_tokens,
        tokensOutput: response.usage?.output_tokens,
        tokensTotal: response.usage?.total_tokens,
        outcome,
      });

      return response;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      meters.aiRequestsTotal.add(1, {
        provider: AI_PROVIDER_NAME,
        outcome: 'error',
      });
      meters.aiRequestDurationMs.record(durationMs, {
        provider: AI_PROVIDER_NAME,
      });
      this.logger.log('OpenAI Responses API call completed', {
        durationMs,
        model: this.model,
        outcome: 'error',
      });
      throw error;
    }
  }

  async generatePracticePlan(prompt: string): Promise<GeneratedPracticePlan> {
    const response = await this.instrumentedParse(() =>
      this.client.responses.parse({
        model: this.model,
        instructions: SYSTEM_INSTRUCTIONS,
        input: prompt,
        tools: [{ type: 'web_search' }],
        text: { format: zodTextFormat(PracticePlanSchema, 'practice_plan') },
      }),
    );

    if (response.status !== 'completed') {
      throw new BadGatewayException(
        `OpenAI practice plan generation did not complete: ${describeIncompleteResponse(response)}`,
      );
    }

    if (!response.output_parsed) {
      throw new BadGatewayException(
        'OpenAI returned a response that did not match the expected practice plan schema',
      );
    }

    return { plan: response.output_parsed, previousResponseId: response.id };
  }

  async confirmAndCreateRoutine(
    previousResponseId: string,
    executeCreateRoutine: CreateRoutineExecutor,
  ): Promise<ConfirmedRoutineCreation> {
    const createRoutineTool = zodResponsesFunction({
      name: 'create_routine',
      description:
        'Persist the confirmed practice routine and its tasks for the authenticated user.',
      parameters: CreateRoutineArgsSchema,
    });

    const response = await this.instrumentedParse(() =>
      this.client.responses.parse({
        model: this.model,
        previous_response_id: previousResponseId,
        input: CONFIRMATION_PROMPT,
        tools: [createRoutineTool],
      }),
    );

    if (response.status !== 'completed') {
      throw new BadGatewayException(
        `OpenAI routine confirmation did not complete: ${describeIncompleteResponse(response)}`,
      );
    }

    const call = response.output.find((item) => item.type === 'function_call');

    if (!call || call.name !== 'create_routine') {
      throw new BadGatewayException(
        'OpenAI did not call the expected create_routine tool',
      );
    }

    const toolResult = await executeCreateRoutine(call.parsed_arguments);

    const followUp = await this.instrumentedParse(() =>
      this.client.responses.parse({
        model: this.model,
        previous_response_id: response.id,
        input: [
          {
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(toolResult),
          },
        ],
      }),
    );

    if (followUp.status !== 'completed') {
      throw new BadGatewayException(
        `OpenAI routine confirmation follow-up did not complete: ${describeIncompleteResponse(followUp)}`,
      );
    }

    return { finalMessage: followUp.output_text, toolResult };
  }
}
