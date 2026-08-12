import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EnvironmentVariables } from '../../config/env.validation';
import { meters } from '../../observability/metrics/meters';
import { PracticePlan } from '../dto/practice-plan.schema';
import { CreateRoutineResult } from '../tools/create-routine.types';
import { OpenAiResponsesService } from './openai-responses.service';

const PREVIOUS_RESPONSE_ID = 'resp_initial';
const MODEL = 'gpt-test-model';

type MockOpenAiClient = {
  responses: {
    parse: jest.Mock;
  };
};

function buildMockConfigService(): ConfigService<EnvironmentVariables, true> {
  return {
    get: jest.fn().mockReturnValue(MODEL),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function buildPracticePlan(
  overrides: Partial<PracticePlan> = {},
): PracticePlan {
  return {
    title: 'Beginner warm-up routine',
    summary: 'A short daily warm-up',
    totalDurationMinutes: 20,
    tasks: [
      {
        title: 'Chromatic warm-up',
        description: 'Slow chromatic run',
        durationMinutes: 10,
      },
      {
        title: 'Chord changes',
        description: 'Practice common chord changes',
        durationMinutes: 10,
      },
    ],
    requiresConfirmation: true,
    ...overrides,
  };
}

function buildCreateRoutineResult(
  overrides: Partial<CreateRoutineResult> = {},
): CreateRoutineResult {
  return {
    routineId: 'routine-1',
    title: 'Beginner warm-up routine',
    taskCount: 2,
    ...overrides,
  };
}

describe('OpenAiResponsesService', () => {
  let client: MockOpenAiClient;
  let service: OpenAiResponsesService;

  beforeEach(() => {
    client = { responses: { parse: jest.fn() } };
    service = new OpenAiResponsesService(
      client as unknown as OpenAI,
      buildMockConfigService(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('generatePracticePlan', () => {
    it('records token usage and request metrics, and logs metadata only', async () => {
      const plan = buildPracticePlan();
      const promptText = 'Plan me a routine focusing on jazz chords';
      client.responses.parse.mockResolvedValue({
        status: 'completed',
        id: PREVIOUS_RESPONSE_ID,
        output_parsed: plan,
        usage: {
          input_tokens: 120,
          output_tokens: 45,
          total_tokens: 165,
        },
      });
      // aiTokensTotal and aiRequestsTotal are both Counters, which share one
      // underlying no-op `add` method in tests (no MeterProvider registered)
      // -- tokensSpy/requestsSpy are the same spy in practice; kept as two
      // names purely for assertion readability below.
      const tokensSpy = jest.spyOn(meters.aiTokensTotal, 'add');
      const requestsSpy = jest.spyOn(meters.aiRequestsTotal, 'add');
      const durationSpy = jest.spyOn(meters.aiRequestDurationMs, 'record');
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      await service.generatePracticePlan(promptText);

      expect(tokensSpy).toHaveBeenCalledWith(120, {
        provider: 'openai-responses',
        kind: 'input',
      });
      expect(tokensSpy).toHaveBeenCalledWith(45, {
        provider: 'openai-responses',
        kind: 'output',
      });
      expect(tokensSpy).toHaveBeenCalledWith(165, {
        provider: 'openai-responses',
        kind: 'total',
      });
      expect(requestsSpy).toHaveBeenCalledWith(1, {
        provider: 'openai-responses',
        outcome: 'success',
      });
      expect(durationSpy).toHaveBeenCalledWith(expect.any(Number), {
        provider: 'openai-responses',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [, meta] = logSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(typeof meta.durationMs).toBe('number');
      expect(meta).toMatchObject({
        model: MODEL,
        tokensInput: 120,
        tokensOutput: 45,
        tokensTotal: 165,
        outcome: 'success',
      });
      expect(Object.keys(meta).sort()).toEqual(
        [
          'durationMs',
          'model',
          'tokensInput',
          'tokensOutput',
          'tokensTotal',
          'outcome',
        ].sort(),
      );
      // Never the prompt text or generated plan content, only metadata.
      const loggedPayload = JSON.stringify(logSpy.mock.calls[0]);
      expect(loggedPayload).not.toContain(promptText);
      expect(loggedPayload).not.toContain(plan.title);
    });

    it('records an error outcome and no token usage when the call throws', async () => {
      const error = new Error('network blip');
      client.responses.parse.mockRejectedValue(error);
      // aiRequestsTotal/aiTokensTotal share the same underlying `add` method
      // under the no-op OTel meter used in tests (no MeterProvider
      // registered), so a single spy on that method sees every counter call
      // made during the request -- asserting no call carries a `kind`
      // attribute is how "no token usage was recorded" is actually provable
      // here, rather than asserting the shared spy was never called at all.
      const addSpy = jest.spyOn(meters.aiRequestsTotal, 'add');

      await expect(
        service.generatePracticePlan('Plan me a routine'),
      ).rejects.toBe(error);

      expect(addSpy).toHaveBeenCalledWith(1, {
        provider: 'openai-responses',
        outcome: 'error',
      });
      const tokenCalls = addSpy.mock.calls.filter(
        ([, attributes]) =>
          (attributes as Record<string, unknown> | undefined)?.kind !==
          undefined,
      );
      expect(tokenCalls).toHaveLength(0);
    });

    it('records an error outcome when the response completes with a non-completed status', async () => {
      client.responses.parse.mockResolvedValue({
        status: 'incomplete',
        id: PREVIOUS_RESPONSE_ID,
        incomplete_details: { reason: 'max_output_tokens' },
        output_parsed: null,
      });
      const requestsSpy = jest.spyOn(meters.aiRequestsTotal, 'add');

      await expect(
        service.generatePracticePlan('Plan me a routine'),
      ).rejects.toThrow(BadGatewayException);

      expect(requestsSpy).toHaveBeenCalledWith(1, {
        provider: 'openai-responses',
        outcome: 'error',
      });
    });

    it('returns the parsed plan and previousResponseId on a completed response', async () => {
      const plan = buildPracticePlan();
      client.responses.parse.mockResolvedValue({
        status: 'completed',
        id: PREVIOUS_RESPONSE_ID,
        output_parsed: plan,
      });

      const result = await service.generatePracticePlan('Plan me a routine');

      expect(result).toEqual({
        plan,
        previousResponseId: PREVIOUS_RESPONSE_ID,
      });
    });

    it('passes web_search as the only tool and never a create_routine/function tool', async () => {
      client.responses.parse.mockResolvedValue({
        status: 'completed',
        id: PREVIOUS_RESPONSE_ID,
        output_parsed: buildPracticePlan(),
      });

      await service.generatePracticePlan('Plan me a routine');

      expect(client.responses.parse).toHaveBeenCalledWith(
        expect.objectContaining({
          model: MODEL,
          input: 'Plan me a routine',
          tools: [{ type: 'web_search' }],
        }),
      );
      const parseMock = client.responses.parse as jest.Mock<
        unknown,
        [{ tools: Array<{ type?: string; name?: string }> }]
      >;
      const callArgs = parseMock.mock.calls[0][0];
      expect(callArgs.tools).toHaveLength(1);
      expect(
        callArgs.tools.some(
          (tool) => tool.type === 'function' || tool.name === 'create_routine',
        ),
      ).toBe(false);
    });

    it('throws BadGatewayException when output_parsed is null', async () => {
      client.responses.parse.mockResolvedValue({
        status: 'completed',
        id: PREVIOUS_RESPONSE_ID,
        output_parsed: null,
      });

      await expect(
        service.generatePracticePlan('Plan me a routine'),
      ).rejects.toThrow(BadGatewayException);
    });

    it('throws BadGatewayException when status is not completed', async () => {
      client.responses.parse.mockResolvedValue({
        status: 'incomplete',
        id: PREVIOUS_RESPONSE_ID,
        incomplete_details: { reason: 'max_output_tokens' },
        output_parsed: null,
      });

      await expect(
        service.generatePracticePlan('Plan me a routine'),
      ).rejects.toThrow(BadGatewayException);
    });

    it('propagates an error thrown by the client unchanged', async () => {
      const error = new Error('boom');
      client.responses.parse.mockRejectedValue(error);

      await expect(
        service.generatePracticePlan('Plan me a routine'),
      ).rejects.toBe(error);
    });
  });

  describe('confirmAndCreateRoutine', () => {
    const CALL_ID = 'call_1';

    type FunctionCallResponse = {
      status: string;
      id: string;
      output: Array<{
        type: string;
        name: string;
        call_id: string;
        parsed_arguments: unknown;
      }>;
    };

    function buildFunctionCallResponse(
      overrides: Partial<FunctionCallResponse> = {},
    ): FunctionCallResponse {
      return {
        status: 'completed',
        id: 'resp_second',
        output: [
          {
            type: 'function_call',
            name: 'create_routine',
            call_id: CALL_ID,
            parsed_arguments: {
              title: 'Beginner warm-up routine',
              notes: '',
              tasks: [
                {
                  title: 'Chromatic warm-up',
                  description: 'Slow run',
                  durationMinutes: 10,
                },
              ],
            },
          },
        ],
        ...overrides,
      };
    }

    it('finds the function_call, executes it, submits the output, and returns the final result', async () => {
      const functionCallResponse = buildFunctionCallResponse();
      const toolResult = buildCreateRoutineResult();
      const followUpResponse = {
        status: 'completed',
        id: 'resp_third',
        output_text: 'Your routine has been created.',
      };
      client.responses.parse
        .mockResolvedValueOnce(functionCallResponse)
        .mockResolvedValueOnce(followUpResponse);
      const executor = jest.fn().mockResolvedValue(toolResult);

      const result = await service.confirmAndCreateRoutine(
        PREVIOUS_RESPONSE_ID,
        executor,
      );

      expect(client.responses.parse).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          model: MODEL,
          previous_response_id: PREVIOUS_RESPONSE_ID,
        }),
      );
      expect(executor).toHaveBeenCalledWith(
        functionCallResponse.output[0].parsed_arguments,
      );
      expect(client.responses.parse).toHaveBeenNthCalledWith(2, {
        model: MODEL,
        previous_response_id: functionCallResponse.id,
        input: [
          {
            type: 'function_call_output',
            call_id: CALL_ID,
            output: JSON.stringify(toolResult),
          },
        ],
      });
      expect(result).toEqual({
        finalMessage: followUpResponse.output_text,
        toolResult,
      });
    });

    it('throws BadGatewayException when no function_call is present', async () => {
      client.responses.parse.mockResolvedValue({
        status: 'completed',
        id: 'resp_second',
        output: [],
      });
      const executor = jest.fn();

      await expect(
        service.confirmAndCreateRoutine(PREVIOUS_RESPONSE_ID, executor),
      ).rejects.toThrow(BadGatewayException);
      expect(executor).not.toHaveBeenCalled();
    });

    it('throws BadGatewayException when the function_call is not named create_routine', async () => {
      client.responses.parse.mockResolvedValue(
        buildFunctionCallResponse({
          output: [
            {
              type: 'function_call',
              name: 'some_other_tool',
              call_id: CALL_ID,
              parsed_arguments: {},
            },
          ],
        }),
      );
      const executor = jest.fn();

      await expect(
        service.confirmAndCreateRoutine(PREVIOUS_RESPONSE_ID, executor),
      ).rejects.toThrow(BadGatewayException);
      expect(executor).not.toHaveBeenCalled();
    });

    it('throws BadGatewayException when the initial response is not completed', async () => {
      client.responses.parse.mockResolvedValue({
        status: 'incomplete',
        id: 'resp_second',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      });
      const executor = jest.fn();

      await expect(
        service.confirmAndCreateRoutine(PREVIOUS_RESPONSE_ID, executor),
      ).rejects.toThrow(BadGatewayException);
      expect(executor).not.toHaveBeenCalled();
    });

    it('throws BadGatewayException when the follow-up response is not completed', async () => {
      const functionCallResponse = buildFunctionCallResponse();
      client.responses.parse
        .mockResolvedValueOnce(functionCallResponse)
        .mockResolvedValueOnce({
          status: 'incomplete',
          id: 'resp_third',
          incomplete_details: { reason: 'max_output_tokens' },
        });
      const executor = jest.fn().mockResolvedValue(buildCreateRoutineResult());

      await expect(
        service.confirmAndCreateRoutine(PREVIOUS_RESPONSE_ID, executor),
      ).rejects.toThrow(BadGatewayException);
    });

    it('propagates an error thrown by the client unchanged', async () => {
      const error = new Error('boom');
      client.responses.parse.mockRejectedValue(error);
      const executor = jest.fn();

      await expect(
        service.confirmAndCreateRoutine(PREVIOUS_RESPONSE_ID, executor),
      ).rejects.toBe(error);
      expect(executor).not.toHaveBeenCalled();
    });

    it('propagates an error thrown by the executor unchanged', async () => {
      client.responses.parse.mockResolvedValueOnce(buildFunctionCallResponse());
      const error = new Error('executor failed');
      const executor = jest.fn().mockRejectedValue(error);

      await expect(
        service.confirmAndCreateRoutine(PREVIOUS_RESPONSE_ID, executor),
      ).rejects.toBe(error);
    });
  });
});
