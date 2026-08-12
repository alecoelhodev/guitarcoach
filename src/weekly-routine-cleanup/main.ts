import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RequestContext } from '../observability/request-context';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { WeeklyRoutineCleanupModule } from './weekly-routine-cleanup.module';
import { WeeklyRoutineCleanupService } from './weekly-routine-cleanup.service';

const logger = new Logger('WeeklyRoutineCleanupBootstrap');

async function run(): Promise<void> {
  // bufferLogs + useLogger mirrors src/main.ts's HTTP bootstrap: every log
  // emitted during module initialization is held until useLogger() below is
  // called, so even early bootstrap/DI logs go through the structured logger.
  const app = await NestFactory.createApplicationContext(
    WeeklyRoutineCleanupModule,
    { bufferLogs: true },
  );
  app.useLogger(app.get(StructuredLoggerService));

  // One execution ID per job run, used as both requestId and correlationId
  // (there's no upstream hop to correlate against, unlike an HTTP request or
  // a queue message) so every log line emitted during this run - including
  // ones from PrismaService - carries it via RequestContext.
  const executionId = randomUUID();

  try {
    await RequestContext.run(
      { requestId: executionId, correlationId: executionId },
      () => app.get(WeeklyRoutineCleanupService).run(),
    );
  } finally {
    await app.close();
  }
}

void run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.error(
      'Weekly routine cleanup failed',
      error instanceof Error ? error.stack : error,
    );
    process.exit(1);
  });
