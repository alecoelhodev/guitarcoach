import { Test, TestingModule } from '@nestjs/testing';
import {
  DiskHealthIndicator,
  HealthCheckService,
  HealthIndicatorFunction,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: jest.Mock };
  let memoryHealthIndicator: {
    checkHeap: jest.Mock;
    checkRSS: jest.Mock;
  };
  let diskHealthIndicator: { checkStorage: jest.Mock };

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn((indicators: HealthIndicatorFunction[]) =>
        Promise.all(indicators.map(async (indicator) => indicator())),
      ),
    };
    memoryHealthIndicator = {
      checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
      checkRSS: jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } }),
    };
    diskHealthIndicator = {
      checkStorage: jest.fn().mockResolvedValue({ disk: { status: 'up' } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: MemoryHealthIndicator, useValue: memoryHealthIndicator },
        { provide: DiskHealthIndicator, useValue: diskHealthIndicator },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('liveness', () => {
    it('runs a health check with no indicators', async () => {
      await controller.liveness();

      expect(healthCheckService.check).toHaveBeenCalledWith([]);
    });
  });

  describe('readiness', () => {
    it('checks heap, RSS, and disk usage', async () => {
      await controller.readiness();

      expect(healthCheckService.check).toHaveBeenCalledWith([
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      ]);

      const [indicators] = healthCheckService.check.mock.calls[0] as [
        HealthIndicatorFunction[],
      ];
      await Promise.all(indicators.map(async (indicator) => indicator()));

      expect(memoryHealthIndicator.checkHeap).toHaveBeenCalledWith(
        'memory_heap',
        300 * 1024 * 1024,
      );
      expect(memoryHealthIndicator.checkRSS).toHaveBeenCalledWith(
        'memory_rss',
        300 * 1024 * 1024,
      );
      expect(diskHealthIndicator.checkStorage).toHaveBeenCalledWith('disk', {
        path: '/',
        thresholdPercent: 0.9,
      });
    });
  });
});
