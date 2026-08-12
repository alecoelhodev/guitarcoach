import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoutineStatus } from '../generated/prisma/enums';
import { meters } from '../observability/metrics/meters';
import { PrismaService } from '../prisma/prisma.service';
import { WeeklyRoutineCleanupEnvironmentVariables } from './env.validation';
import { resolveWeekStart } from './week-boundary.util';

const JOB_NAME = 'weekly-routine-cleanup';

export interface WeeklyRoutineCleanupResult {
  weekStart: Date;
  archivedCount: number;
  durationMs: number;
}

@Injectable()
export class WeeklyRoutineCleanupService {
  private readonly logger = new Logger(WeeklyRoutineCleanupService.name);

  // Both params use explicit @Inject(): esbuild (used by `tsx`, the local/
  // dev runner for this job) doesn't reliably emit constructor decorator
  // metadata once any parameter has a generic-instantiated type like
  // `ConfigService<T, true>` — it silently corrupted resolution for every
  // parameter, not just that one. `nest build` (plain tsc) and ts-jest-based
  // tests are unaffected, but resolving every token explicitly here makes
  // injection work identically under every toolchain.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly configService: ConfigService<
      WeeklyRoutineCleanupEnvironmentVariables,
      true
    >,
  ) {}

  async run(): Promise<WeeklyRoutineCleanupResult> {
    const startedAt = Date.now();

    try {
      const weekStart = resolveWeekStart({
        timeZone: this.configService.get('ROUTINE_CLEANUP_TIME_ZONE', {
          infer: true,
        }),
        override: this.configService.get('CLEANUP_WEEK_START', {
          infer: true,
        }),
      });

      this.logger.log(
        `Weekly routine cleanup started; week start = ${weekStart.toISOString()}`,
      );

      // Idempotent by construction: once a routine's status flips to archived
      // it no longer matches `status: active` on a later run, so rerunning
      // this job is always safe.
      const { count: archivedCount } = await this.prisma.routine.updateMany({
        where: { status: RoutineStatus.active, createdAt: { lt: weekStart } },
        data: { status: RoutineStatus.archived },
      });

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `Weekly routine cleanup completed: archived ${archivedCount} routine(s) in ${durationMs}ms`,
      );

      meters.jobRunsTotal.add(1, { job: JOB_NAME, outcome: 'success' });
      meters.jobDurationMs.record(durationMs, { job: JOB_NAME });

      return { weekStart, archivedCount, durationMs };
    } catch (error) {
      meters.jobRunsTotal.add(1, { job: JOB_NAME, outcome: 'failure' });
      throw error;
    }
  }
}
