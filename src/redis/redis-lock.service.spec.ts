import { createClient } from '@redis/client';
import { meters } from '../observability/metrics/meters';
import { RedisLockService } from './redis-lock.service';

jest.mock('@redis/client', () => ({
  createClient: jest.fn(),
}));

type MockRedisClient = {
  set: jest.Mock;
  eval: jest.Mock;
  on: jest.Mock;
  connect: jest.Mock;
  quit: jest.Mock;
};

describe('RedisLockService', () => {
  let service: RedisLockService;
  let client: MockRedisClient;

  beforeEach(() => {
    client = {
      set: jest.fn(),
      eval: jest.fn(),
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    (createClient as jest.Mock).mockReturnValue(client);

    service = new RedisLockService('redis://localhost:6379');
  });

  afterEach(() => jest.restoreAllMocks());

  describe('acquire', () => {
    it('returns a token when the key is not already held', async () => {
      client.set.mockResolvedValue('OK');

      const token = await service.acquire('lock:key', 5000);

      expect(token).not.toBeNull();
    });

    it('returns null when the key is already held', async () => {
      client.set.mockResolvedValue(null);

      await expect(service.acquire('lock:key', 5000)).resolves.toBeNull();
    });

    it('counts the failure and rethrows when Redis is unavailable', async () => {
      const addSpy = jest.spyOn(meters.redisOperationFailuresTotal, 'add');
      client.set.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.acquire('lock:key', 5000)).rejects.toThrow(
        'Redis unavailable',
      );
      expect(addSpy).toHaveBeenCalledWith(1, {
        client: 'lock',
        operation: 'acquire',
      });
    });
  });

  describe('release', () => {
    it('releases the lock via the CAS release script', async () => {
      client.eval.mockResolvedValue(1);

      await expect(
        service.release('lock:key', 'some-token'),
      ).resolves.toBeUndefined();
    });

    it('counts the failure and rethrows when Redis is unavailable', async () => {
      const addSpy = jest.spyOn(meters.redisOperationFailuresTotal, 'add');
      client.eval.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.release('lock:key', 'some-token')).rejects.toThrow(
        'Redis unavailable',
      );
      expect(addSpy).toHaveBeenCalledWith(1, {
        client: 'lock',
        operation: 'release',
      });
    });
  });
});
