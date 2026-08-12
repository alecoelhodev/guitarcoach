import { createClient } from '@redis/client';
import { meters } from '../observability/metrics/meters';
import { SecurityEventLogger } from '../observability/security-event.logger';
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
    afterEach(() => jest.restoreAllMocks());

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
      client.eval.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        service.consume('key', { window: 60, max: 5 }),
      ).resolves.toEqual({ allowed: true, retryAfter: null });
    });

    it('counts and logs a security event on a genuine denial, using only the route from the key', async () => {
      // Only one spy: with metrics export disabled (no MeterProvider
      // registered, the default in unit tests), @opentelemetry/api's no-op
      // implementation returns the exact same singleton counter object for
      // every meter.createCounter() call, so meters.rateLimitDeniedTotal and
      // meters.redisOperationFailuresTotal alias to the same object/method
      // here. Spying on both independently would double-wrap the same
      // method; asserting on call args from a single spy distinguishes them
      // instead (rateLimitDeniedTotal.add takes one arg, the failure counter
      // takes two).
      const addSpy = jest.spyOn(meters.redisOperationFailuresTotal, 'add');
      const securityLogSpy = jest
        .spyOn(SecurityEventLogger.prototype, 'log')
        .mockImplementation(() => undefined);
      client.eval.mockResolvedValue([6, 30]);

      await service.consume('203.0.113.5|/sign-in/email', {
        window: 60,
        max: 5,
      });

      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(addSpy).toHaveBeenCalledWith(1);
      expect(securityLogSpy).toHaveBeenCalledWith({
        eventType: 'rate_limit.denied',
        outcome: 'denied',
        targetType: 'route',
        targetId: '/sign-in/email',
        detail: { window: 60, max: 5 },
      });
    });

    it('counts the Redis failure but does not log a security event when failing open', async () => {
      const addSpy = jest.spyOn(meters.redisOperationFailuresTotal, 'add');
      const securityLogSpy = jest
        .spyOn(SecurityEventLogger.prototype, 'log')
        .mockImplementation(() => undefined);
      client.eval.mockRejectedValue(new Error('Redis unavailable'));

      await service.consume('203.0.113.5|/sign-in/email', {
        window: 60,
        max: 5,
      });

      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(addSpy).toHaveBeenCalledWith(1, {
        client: 'rate-limit',
        operation: 'consume',
      });
      expect(securityLogSpy).not.toHaveBeenCalled();
    });
  });
});
