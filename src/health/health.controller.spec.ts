import { Test, TestingModule } from '@nestjs/testing';
import {
  DiskHealthIndicator,
  HealthCheckService,
  HealthIndicatorFunction,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: jest.Mock };
  let memoryHealthIndicator: {
    checkHeap: jest.Mock;
    checkRSS: jest.Mock;
  };
  let diskHealthIndicator: { checkStorage: jest.Mock };
  let prismaHealthIndicator: { pingCheck: jest.Mock };
  let prismaService: PrismaService;

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
    prismaHealthIndicator = {
      pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
    };
    prismaService = {} as PrismaService;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: MemoryHealthIndicator, useValue: memoryHealthIndicator },
        { provide: DiskHealthIndicator, useValue: diskHealthIndicator },
        { provide: PrismaHealthIndicator, useValue: prismaHealthIndicator },
        { provide: PrismaService, useValue: prismaService },
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
    it('checks heap, RSS, disk usage, and database connectivity', async () => {
      await controller.readiness();

      expect(healthCheckService.check).toHaveBeenCalledWith([
        expect.any(Function),
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
      expect(prismaHealthIndicator.pingCheck).toHaveBeenCalledWith(
        'database',
        prismaService,
      );
    });
  });
});
