import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RedisRateLimitStorage } from '../auth/redis-rate-limit-storage';
import { EnvironmentVariables } from '../config/env.validation';

const WINDOW_SECONDS = 60 * 60;

/**
 * Per-user cap on the AI endpoints, which each cost an OpenAI call. Shares the auth rate
 * limiter's atomic Redis window, so it also fails open when Redis is down. Runs after the
 * global AuthGuard, which has already attached the user.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  private readonly maxPerHour: number;

  constructor(
    private readonly storage: RedisRateLimitStorage,
    configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxPerHour = configService.get('AI_RATE_LIMIT_PER_HOUR', {
      infer: true,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id: string } }>();
    const userId = request.user?.id;
    // Unauthenticated requests never reach here; the AuthGuard already 401'd them.
    if (!userId) return true;

    // `|/ai` keeps the security event's route field (everything after `|`) free of the id.
    const { allowed, retryAfter } = await this.storage.consume(
      `ai:${userId}|/ai`,
      { window: WINDOW_SECONDS, max: this.maxPerHour },
    );
    if (allowed) return true;

    http
      .getResponse<Response>()
      .setHeader('Retry-After', String(retryAfter ?? WINDOW_SECONDS));
    throw new HttpException(
      'Too many AI requests. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
