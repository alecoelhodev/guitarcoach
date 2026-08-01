import { Logger } from '@nestjs/common';
import { createClient } from '@redis/client';
import { RedisRateLimitStorage } from './redis-rate-limit-storage';

jest.mock('@redis/client', () => ({
  createClient: jest.fn(),
}));

type MockRedisClient = {
  eval: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  on: jest.Mock;
  connect: jest.Mock;
  quit: jest.Mock;
};

describe('RedisRateLimitStorage', () => {
  let service: RedisRateLimitStorage;
  let client: MockRedisClient;

  beforeEach(() => {
    client = {
      eval: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    (createClient as jest.Mock).mockReturnValue(client);

    service = new RedisRateLimitStorage('redis://localhost:6379');
  });

  describe('consume', () => {
    it('allows the request when under the limit', async () => {
      client.eval.mockResolvedValue([1, 60]);

      await expect(
        service.consume('key', { window: 60, max: 5 }),
      ).resolves.toEqual({ allowed: true, retryAfter: null });
    });

    it('denies the request and returns the remaining TTL when over the limit', async () => {
      client.eval.mockResolvedValue([6, 30]);

      await expect(
        service.consume('key', { window: 60, max: 5 }),
      ).resolves.toEqual({ allowed: false, retryAfter: 30 });
    });

    it('fails open when Redis is unavailable', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      client.eval.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        service.consume('key', { window: 60, max: 5 }),
      ).resolves.toEqual({ allowed: true, retryAfter: null });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit check failed for key "key"'),
        expect.any(Error),
      );

      warnSpy.mockRestore();
    });
  });
});
