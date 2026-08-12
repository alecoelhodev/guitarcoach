import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { RedisClientType } from '@redis/client';
import { RedisHealthIndicator } from './redis.health-indicator';

type MockRedisClient = {
  connect: jest.Mock;
  ping: jest.Mock;
  destroy: jest.Mock;
};

function buildMockClient(overrides: Partial<MockRedisClient> = {}) {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    destroy: jest.fn(),
    ...overrides,
  };
}

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let mockClient: MockRedisClient;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    mockClient = buildMockClient();
    configService = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    };

    // Overrides the protected client-creation seam so the fake client can be
    // asserted on directly, without module-mocking `@redis/client`.
    class TestableRedisHealthIndicator extends RedisHealthIndicator {
      protected createRedisClient(): RedisClientType {
        return mockClient as unknown as RedisClientType;
      }
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestableRedisHealthIndicator,
        HealthIndicatorService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    indicator = module.get(TestableRedisHealthIndicator);
  });

  describe('pingCheck', () => {
    it('reports up and closes the connection when Redis responds to PING', async () => {
      await expect(indicator.pingCheck('redis')).resolves.toEqual({
        redis: { status: 'up' },
      });

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.ping).toHaveBeenCalled();
      expect(mockClient.destroy).toHaveBeenCalled();
    });

    it('reports down without leaking connection details when Redis is unreachable', async () => {
      mockClient.connect.mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:6379'),
      );

      const result = await indicator.pingCheck('redis');

      expect(result).toEqual({
        redis: { status: 'down', message: 'unreachable' },
      });
      expect(mockClient.destroy).toHaveBeenCalled();
    });

    it('reports down when the check exceeds the bounded timeout', async () => {
      mockClient.connect.mockImplementation(() => new Promise(() => {}));

      const result = await indicator.pingCheck('redis');

      expect(result).toEqual({
        redis: { status: 'down', message: 'unreachable' },
      });
      expect(mockClient.destroy).toHaveBeenCalled();
    });
  });
});
