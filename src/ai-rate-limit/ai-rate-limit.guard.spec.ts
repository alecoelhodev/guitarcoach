import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisRateLimitStorage } from '../auth/redis-rate-limit-storage';
import { AiRateLimitGuard } from './ai-rate-limit.guard';

function contextFor(user?: { id: string }) {
  const response = { setHeader: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, response };
}

describe('AiRateLimitGuard', () => {
  let storage: { consume: jest.Mock };
  let guard: AiRateLimitGuard;

  beforeEach(() => {
    storage = { consume: jest.fn() };
    const config = { get: jest.fn(() => 30) } as unknown as ConfigService;
    guard = new AiRateLimitGuard(
      storage as unknown as RedisRateLimitStorage,
      config as never,
    );
  });

  it('counts each request against an hourly window per user', async () => {
    storage.consume.mockResolvedValue({ allowed: true, retryAfter: null });
    const { context } = contextFor({ id: 'u1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.consume).toHaveBeenCalledWith('ai:u1|/ai', {
      window: 3600,
      max: 30,
    });
  });

  it('answers 429 with Retry-After once the window is used up', async () => {
    storage.consume.mockResolvedValue({ allowed: false, retryAfter: 1200 });
    const { context, response } = contextFor({ id: 'u1' });

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '1200');
  });

  it('leaves a request without a user to the AuthGuard', async () => {
    const { context } = contextFor(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.consume).not.toHaveBeenCalled();
  });
});
