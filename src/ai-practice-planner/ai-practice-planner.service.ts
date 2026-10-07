import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import {
  assertValidPracticePlan,
  PracticePlan,
} from './dto/practice-plan.schema';
import { PracticePlannerRequestDto } from './dto/practice-planner-request.dto';
import type { AiProvider } from './openai/ai-provider';
import { callAiProvider } from './openai/call-ai-provider';
import { AI_PROVIDER } from './openai/openai.constants';
import { CreateRoutineTool } from './tools/create-routine.tool';
import { CreateRoutineResult } from './tools/create-routine.types';

const OWNERSHIP_CACHE_PREFIX = 'ai-practice-planner';
const PLANNER_UNAVAILABLE = 'AI practice planner is temporarily unavailable';
const PLAN_OWNERSHIP_TTL_MS = 15 * 60 * 1000;

export type PracticePlannerResponse =
  | {
      status: 'awaiting_confirmation';
      plan: PracticePlan;
      previousResponseId: string;
    }
  | { status: 'created'; routine: CreateRoutineResult }
  | { status: 'cancelled' };

@Injectable()
export class AiPracticePlannerService {
  private readonly logger = new Logger(AiPracticePlannerService.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
    private readonly createRoutineTool: CreateRoutineTool,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async handleRequest(
    userId: string,
    dto: PracticePlannerRequestDto,
  ): Promise<PracticePlannerResponse> {
    const isNewPrompt = dto.prompt !== undefined;
    const isConfirmation = dto.confirmation !== undefined;

    if (isNewPrompt === isConfirmation) {
      throw new BadRequestException(
        'Request must include either "prompt" or "confirmation"+"previousResponseId", not both',
      );
    }

    if (isNewPrompt) {
      return this.startPlan(userId, dto.prompt as string);
    }

    return this.resolveConfirmation(userId, dto);
  }

  private async startPlan(
    userId: string,
    prompt: string,
  ): Promise<PracticePlannerResponse> {
    const result = await callAiProvider(
      () => this.aiProvider.generatePracticePlan(prompt),
      PLANNER_UNAVAILABLE,
    );

    assertValidPracticePlan(result.plan);

    try {
      await this.cache.set(
        this.ownershipCacheKey(result.previousResponseId),
        userId,
        PLAN_OWNERSHIP_TTL_MS,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to cache ownership for response "${result.previousResponseId}"`,
        error,
      );
    }

    return {
      status: 'awaiting_confirmation',
      plan: result.plan,
      previousResponseId: result.previousResponseId,
    };
  }

  private async resolveConfirmation(
    userId: string,
    dto: PracticePlannerRequestDto,
  ): Promise<PracticePlannerResponse> {
    if (dto.confirmation === false) {
      return { status: 'cancelled' };
    }

    if (!dto.previousResponseId) {
      throw new BadRequestException(
        'previousResponseId is required to confirm a practice plan',
      );
    }

    const cachedUserId = await this.readOwnershipFromCache(
      dto.previousResponseId,
    );
    if (cachedUserId !== userId) {
      throw new NotFoundException('Practice plan not found or expired');
    }

    const result = await callAiProvider(
      () =>
        this.aiProvider.confirmAndCreateRoutine(
          dto.previousResponseId as string,
          (rawArgs) => this.createRoutineTool.execute(userId, rawArgs),
        ),
      PLANNER_UNAVAILABLE,
    );

    return { status: 'created', routine: result.toolResult };
  }

  private ownershipCacheKey(previousResponseId: string): string {
    return `${OWNERSHIP_CACHE_PREFIX}:${previousResponseId}`;
  }

  // Fail-closed: any cache error, miss, or ownership mismatch must produce
  // the same "not found" outcome to the caller (see readOwnershipFromCache
  // callers) -- this is the actual security boundary, unlike the fail-open
  // write in startPlan.
  private async readOwnershipFromCache(
    previousResponseId: string,
  ): Promise<string | null> {
    try {
      const cached = await this.cache.get<string>(
        this.ownershipCacheKey(previousResponseId),
      );
      return cached ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed to read cached ownership for response "${previousResponseId}"`,
        error,
      );
      return null;
    }
  }
}
