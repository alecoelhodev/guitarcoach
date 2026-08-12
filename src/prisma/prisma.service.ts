import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { meters } from '../observability/metrics/meters';

/**
 * Starting threshold (ms) above which a query is warn-logged as slow via the
 * `PrismaSlowQuery` logger. This is a reasonable starting point, not a tuned
 * production value — there's no production latency baseline yet, so revisit
 * once one exists.
 */
const SLOW_QUERY_THRESHOLD_MS = 500;

const slowQueryLogger = new Logger('PrismaSlowQuery');

/**
 * The actual `$allOperations` query-extension logic, extracted as a plain,
 * independently-testable function (mirroring the tool-handler pattern in
 * `src/ai-routine-coach/tools/`) so unit tests can exercise the
 * timing/metric/slow-log behavior directly, without spinning up a real
 * Prisma engine or Postgres connection.
 */
export async function recordQueryDuration({
  model,
  operation,
  args,
  query,
}: {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}): Promise<unknown> {
  const start = performance.now();
  try {
    return await query(args);
  } finally {
    const durationMs = performance.now() - start;
    // Labels are model/action only — never query args/where values, which
    // may contain user data and would also blow up metric cardinality.
    meters.dbQueryDurationMs.record(durationMs, { model, action: operation });
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      slowQueryLogger.warn(
        `Slow query: ${model}.${operation} took ${durationMs.toFixed(1)}ms`,
      );
    }
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    super({ adapter });

    // `$extends()` returns a NEW client instance rather than mutating `this`
    // in place — it's documented Prisma Client Extensions behavior, and
    // confirmed by reading @prisma/client's own runtime source (the `query`
    // extension component rebuilds the client via `Object.create` off the
    // original instance rather than patching it). A derived class
    // constructor is allowed to return a different object, which then
    // becomes the result of `new PrismaService()`, so we reassign here
    // instead of discarding the extended client. NestJS's DI container just
    // stores whatever this constructor returns under the `PrismaService`
    // token, and its lifecycle-hook dispatch (`onModuleDestroy` below) works
    // by duck-typing the resolved instance for a callable method, not by
    // `instanceof PrismaService` — verified empirically against the actual
    // generated client, since instanceof itself does NOT hold for the
    // extended object. Every existing call site
    // (`prismaService.task.findMany()`, `$transaction`, etc.) keeps working
    // unchanged, and every query now also runs through the instrumentation
    // below.
    return this.withQueryInstrumentation() as this;
  }

  private withQueryInstrumentation() {
    return this.$extends({
      query: {
        $allModels: {
          $allOperations: recordQueryDuration,
        },
      },
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
