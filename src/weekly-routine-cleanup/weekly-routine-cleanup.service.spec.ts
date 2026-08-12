import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RoutineStatus } from '../generated/prisma/enums';
import { meters } from '../observability/metrics/meters';
import { PrismaService } from '../prisma/prisma.service';
import { WeeklyRoutineCleanupService } from './weekly-routine-cleanup.service';

type MockPrismaService = {
  routine: { updateMany: jest.Mock };
};

describe('WeeklyRoutineCleanupService', () => {
  let service: WeeklyRoutineCleanupService;
  let prisma: MockPrismaService;
  let configValues: Record<string, unknown>;

  beforeEach(async () => {
    prisma = { routine: { updateMany: jest.fn() } };
    prisma.routine.updateMany.mockResolvedValue({ count: 3 });

    configValues = {
      ROUTINE_CLEANUP_TIME_ZONE: 'UTC',
      CLEANUP_WEEK_START: '2026-07-27T00:00:00Z',
    };
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    };

    const module = await Test.createTestingModule({
      providers: [
        WeeklyRoutineCleanupService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(WeeklyRoutineCleanupService);
  });

  it('archives active routines created before the resolved week start', async () => {
    const result = await service.run();

    expect(prisma.routine.updateMany).toHaveBeenCalledWith({
      where: {
        status: RoutineStatus.active,
        createdAt: { lt: new Date('2026-07-27T00:00:00Z') },
      },
      data: { status: RoutineStatus.archived },
    });
    expect(result.archivedCount).toBe(3);
    expect(result.weekStart).toEqual(new Date('2026-07-27T00:00:00Z'));
  });

  it('resolves the week start from ROUTINE_CLEANUP_TIME_ZONE when no override is set', async () => {
    configValues.CLEANUP_WEEK_START = undefined;
    jest.useFakeTimers().setSystemTime(new Date('2024-01-03T15:30:00Z'));

    await service.run();

    expect(prisma.routine.updateMany).toHaveBeenCalledWith({
      where: {
        status: RoutineStatus.active,
        createdAt: { lt: new Date('2024-01-01T00:00:00.000Z') },
      },
      data: { status: RoutineStatus.archived },
    });

    jest.useRealTimers();
  });

  it('surfaces zero archived routines without error', async () => {
    prisma.routine.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.run();

    expect(result.archivedCount).toBe(0);
  });

  it('propagates database errors instead of swallowing them', async () => {
    prisma.routine.updateMany.mockRejectedValue(new Error('connection lost'));

    await expect(service.run()).rejects.toThrow('connection lost');
  });

  describe('job metrics', () => {
    let jobRunsAddSpy: jest.SpyInstance;
    let jobDurationRecordSpy: jest.SpyInstance;

    beforeEach(() => {
      jobRunsAddSpy = jest.spyOn(meters.jobRunsTotal, 'add');
      jobDurationRecordSpy = jest.spyOn(meters.jobDurationMs, 'record');
    });

    afterEach(() => {
      jobRunsAddSpy.mockRestore();
      jobDurationRecordSpy.mockRestore();
    });

    it('records a success outcome and the run duration', async () => {
      const result = await service.run();

      expect(jobRunsAddSpy).toHaveBeenCalledWith(1, {
        job: 'weekly-routine-cleanup',
        outcome: 'success',
      });
      expect(jobDurationRecordSpy).toHaveBeenCalledWith(result.durationMs, {
        job: 'weekly-routine-cleanup',
      });
    });

    it('records a failure outcome without recording a duration', async () => {
      prisma.routine.updateMany.mockRejectedValue(new Error('connection lost'));

      await expect(service.run()).rejects.toThrow('connection lost');

      expect(jobRunsAddSpy).toHaveBeenCalledWith(1, {
        job: 'weekly-routine-cleanup',
        outcome: 'failure',
      });
      expect(jobDurationRecordSpy).not.toHaveBeenCalled();
    });
  });
});
