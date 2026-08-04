import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WeeklyRoutineCleanupModule } from './weekly-routine-cleanup.module';
import { WeeklyRoutineCleanupService } from './weekly-routine-cleanup.service';

const logger = new Logger('WeeklyRoutineCleanupBootstrap');

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    WeeklyRoutineCleanupModule,
    { logger: ['log', 'warn', 'error'] },
  );

  try {
    await app.get(WeeklyRoutineCleanupService).run();
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
