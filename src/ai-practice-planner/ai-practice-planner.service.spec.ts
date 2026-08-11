import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import OpenAI from 'openai';
import {
  AiPracticePlannerService,
  PracticePlannerResponse,
} from './ai-practice-planner.service';
import { PracticePlan } from './dto/practice-plan.schema';
import { PracticePlannerRequestDto } from './dto/practice-planner-request.dto';
import {
  ConfirmedRoutineCreation,
  GeneratedPracticePlan,
} from './openai/ai-provider';
import { AI_PROVIDER } from './openai/openai.constants';
import { CreateRoutineTool } from './tools/create-routine.tool';
import { CreateRoutineResult } from './tools/create-routine.types';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const OTHER_USER_ID = 'a3f1c2d4-3333-4b2a-9c3d-000000000000';
const RESPONSE_ID = 'resp_123';

function buildPlan(overrides: Partial<PracticePlan> = {}): PracticePlan {
  return {
    title: '30-Minute Blues Practice',
    summary: 'Practice bending accuracy and blues improvisation.',
    totalDurationMinutes: 30,
    tasks: [
      { title: 'Warm-up', description: 'Loosen up', durationMinutes: 30 },
    ],
    requiresConfirmation: true,
    ...overrides,
  };
}

function buildRoutineResult(
  overrides: Partial<CreateRoutineResult> = {},
): CreateRoutineResult {
  return {
    routineId: 'r1',
    title: '30-Minute Blues Practice',
    taskCount: 1,
    ...overrides,
  };
}

type MockAiProvider = {
  generatePracticePlan: jest.Mock;
  confirmAndCreateRoutine: jest.Mock;
};

type MockCreateRoutineTool = {
  execute: jest.Mock;
};

type MockCache = {
  get: jest.Mock;
  set: jest.Mock;
};

describe('AiPracticePlannerService', () => {
  let service: AiPracticePlannerService;
  let aiProvider: MockAiProvider;
  let createRoutineTool: MockCreateRoutineTool;
  let cache: MockCache;

  beforeEach(async () => {
    aiProvider = {
      generatePracticePlan: jest.fn(),
      confirmAndCreateRoutine: jest.fn(),
    };
    createRoutineTool = { execute: jest.fn() };
    cache = { get: jest.fn(), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiPracticePlannerService,
        { provide: AI_PROVIDER, useValue: aiProvider },
        { provide: CreateRoutineTool, useValue: createRoutineTool },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    service = module.get<AiPracticePlannerService>(AiPracticePlannerService);
  });

  describe('handleRequest', () => {
    describe('new-prompt branch', () => {
      it('returns awaiting_confirmation with the plan and caches the ownership binding', async () => {
        const plan = buildPlan();
        const generated: GeneratedPracticePlan = {
          plan,
          previousResponseId: RESPONSE_ID,
        };
        aiProvider.generatePracticePlan.mockResolvedValue(generated);

        const dto: PracticePlannerRequestDto = { prompt: 'A blues routine' };
        const result = await service.handleRequest(USER_ID, dto);

        expect(aiProvider.generatePracticePlan).toHaveBeenCalledWith(
          'A blues routine',
        );
        expect(result).toEqual<PracticePlannerResponse>({
          status: 'awaiting_confirmation',
          plan,
          previousResponseId: RESPONSE_ID,
        });
        expect(cache.set).toHaveBeenCalledWith(
          `ai-practice-planner:${RESPONSE_ID}`,
          USER_ID,
          expect.any(Number),
        );
      });

      it('propagates BadGatewayException when the plan fails business validation', async () => {
        const invalidPlan = buildPlan({ tasks: [] });
        aiProvider.generatePracticePlan.mockResolvedValue({
          plan: invalidPlan,
          previousResponseId: RESPONSE_ID,
        });

        await expect(
          service.handleRequest(USER_ID, { prompt: 'A blues routine' }),
        ).rejects.toBeInstanceOf(BadGatewayException);

        expect(cache.set).not.toHaveBeenCalled();
      });

      it('does not fail the request when the ownership cache write throws', async () => {
        const plan = buildPlan();
        aiProvider.generatePracticePlan.mockResolvedValue({
          plan,
          previousResponseId: RESPONSE_ID,
        });
        cache.set.mockRejectedValue(new Error('Redis unavailable'));

        const result = await service.handleRequest(USER_ID, {
          prompt: 'A blues routine',
        });

        expect(result.status).toBe('awaiting_confirmation');
      });
    });

    describe('confirmation branch', () => {
      it('returns cancelled and never calls confirmAndCreateRoutine when confirmation is false', async () => {
        const dto: PracticePlannerRequestDto = {
          confirmation: false,
          previousResponseId: RESPONSE_ID,
        };

        const result = await service.handleRequest(USER_ID, dto);

        expect(result).toEqual<PracticePlannerResponse>({
          status: 'cancelled',
        });
        expect(cache.get).not.toHaveBeenCalled();
        expect(aiProvider.confirmAndCreateRoutine).not.toHaveBeenCalled();
      });

      it('calls confirmAndCreateRoutine and returns created when the cached userId matches', async () => {
        cache.get.mockResolvedValue(USER_ID);
        const routine = buildRoutineResult();
        const confirmed: ConfirmedRoutineCreation = {
          finalMessage: 'Done',
          toolResult: routine,
        };
        aiProvider.confirmAndCreateRoutine.mockResolvedValue(confirmed);

        const dto: PracticePlannerRequestDto = {
          confirmation: true,
          previousResponseId: RESPONSE_ID,
        };
        const result = await service.handleRequest(USER_ID, dto);

        expect(cache.get).toHaveBeenCalledWith(
          `ai-practice-planner:${RESPONSE_ID}`,
        );
        expect(aiProvider.confirmAndCreateRoutine).toHaveBeenCalledWith(
          RESPONSE_ID,
          expect.any(Function),
        );
        expect(result).toEqual<PracticePlannerResponse>({
          status: 'created',
          routine,
        });
      });

      it('delegates the executor to createRoutineTool.execute with the session userId, never the DTO', async () => {
        cache.get.mockResolvedValue(USER_ID);
        aiProvider.confirmAndCreateRoutine.mockImplementation(
          async (
            _previousResponseId: string,
            executor: (rawArgs: unknown) => Promise<CreateRoutineResult>,
          ) => {
            const toolResult = await executor({ title: 'x' });
            return { finalMessage: 'done', toolResult };
          },
        );
        createRoutineTool.execute.mockResolvedValue(buildRoutineResult());

        // dto has no userId field at all; passing a differently-shaped dto
        // that could theoretically carry stray fields must not matter --
        // the executor must always use the handleRequest userId argument.
        await service.handleRequest(USER_ID, {
          confirmation: true,
          previousResponseId: RESPONSE_ID,
        });

        expect(createRoutineTool.execute).toHaveBeenCalledWith(USER_ID, {
          title: 'x',
        });
      });

      it('throws NotFoundException when the cached userId belongs to a different user', async () => {
        cache.get.mockResolvedValue(OTHER_USER_ID);

        const dto: PracticePlannerRequestDto = {
          confirmation: true,
          previousResponseId: RESPONSE_ID,
        };

        await expect(
          service.handleRequest(USER_ID, dto),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(aiProvider.confirmAndCreateRoutine).not.toHaveBeenCalled();
      });

      it('throws NotFoundException (fail-closed) when the cache read throws', async () => {
        cache.get.mockRejectedValue(new Error('Redis unavailable'));

        const dto: PracticePlannerRequestDto = {
          confirmation: true,
          previousResponseId: RESPONSE_ID,
        };

        await expect(
          service.handleRequest(USER_ID, dto),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(aiProvider.confirmAndCreateRoutine).not.toHaveBeenCalled();
      });

      it('throws NotFoundException when there is no cached ownership at all', async () => {
        cache.get.mockResolvedValue(undefined);

        const dto: PracticePlannerRequestDto = {
          confirmation: true,
          previousResponseId: RESPONSE_ID,
        };

        await expect(
          service.handleRequest(USER_ID, dto),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(aiProvider.confirmAndCreateRoutine).not.toHaveBeenCalled();
      });
    });

    describe('shape validation', () => {
      it('throws BadRequestException when neither prompt nor confirmation is set', async () => {
        await expect(service.handleRequest(USER_ID, {})).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });

      it('throws BadRequestException when both prompt and confirmation are set', async () => {
        await expect(
          service.handleRequest(USER_ID, {
            prompt: 'A blues routine',
            confirmation: true,
            previousResponseId: RESPONSE_ID,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('OpenAI error mapping', () => {
      // Per the error-mapping contract, only OpenAI SDK error classes are
      // translated -- a plain, non-OpenAI Error is rethrown unchanged rather
      // than swallowed or silently mapped to some other exception type.
      it('rethrows a plain, non-OpenAI Error unchanged rather than swallowing it', async () => {
        const originalError = new Error('boom');
        aiProvider.generatePracticePlan.mockRejectedValue(originalError);

        await expect(
          service.handleRequest(USER_ID, { prompt: 'A blues routine' }),
        ).rejects.toBe(originalError);
      });

      it('maps OpenAI.APIConnectionTimeoutError to GatewayTimeoutException', async () => {
        aiProvider.generatePracticePlan.mockRejectedValue(
          new OpenAI.APIConnectionTimeoutError(),
        );

        await expect(
          service.handleRequest(USER_ID, { prompt: 'A blues routine' }),
        ).rejects.toBeInstanceOf(GatewayTimeoutException);
      });

      it('maps OpenAI.RateLimitError to ServiceUnavailableException', async () => {
        aiProvider.generatePracticePlan.mockRejectedValue(
          new OpenAI.RateLimitError(
            429,
            undefined,
            'rate limited',
            new Headers(),
          ),
        );

        await expect(
          service.handleRequest(USER_ID, { prompt: 'A blues routine' }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
      });

      it('maps a generic OpenAI.APIConnectionError to ServiceUnavailableException', async () => {
        aiProvider.generatePracticePlan.mockRejectedValue(
          new OpenAI.APIConnectionError({ message: 'connection reset' }),
        );

        await expect(
          service.handleRequest(USER_ID, { prompt: 'A blues routine' }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
      });
    });
  });
});
