import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodResponsesFunction, zodTextFormat } from 'openai/helpers/zod';
import { EnvironmentVariables } from '../../config/env.validation';
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
  private readonly model: string;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI,
    configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.model = configService.get('OPENAI_MODEL', { infer: true });
  }

  async generatePracticePlan(prompt: string): Promise<GeneratedPracticePlan> {
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: SYSTEM_INSTRUCTIONS,
      input: prompt,
      tools: [{ type: 'web_search' }],
      text: { format: zodTextFormat(PracticePlanSchema, 'practice_plan') },
    });

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

    const response = await this.client.responses.parse({
      model: this.model,
      previous_response_id: previousResponseId,
      input: CONFIRMATION_PROMPT,
      tools: [createRoutineTool],
    });

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

    const followUp = await this.client.responses.parse({
      model: this.model,
      previous_response_id: response.id,
      input: [
        {
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(toolResult),
        },
      ],
    });

    if (followUp.status !== 'completed') {
      throw new BadGatewayException(
        `OpenAI routine confirmation follow-up did not complete: ${describeIncompleteResponse(followUp)}`,
      );
    }

    return { finalMessage: followUp.output_text, toolResult };
  }
}
