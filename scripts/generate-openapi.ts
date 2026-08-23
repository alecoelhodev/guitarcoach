import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { buildSwaggerConfig } from '../src/swagger.config';

// Loading AppModule pulls in @openai/agents-core, whose TraceProvider installs
// its own process-wide 'unhandledRejection' listener that force-exits when
// it's the *only* listener (see main.ts's identical comment/workaround). This
// script has no server-side listener of its own otherwise, so any rejection
// during module init would be silently swallowed by an unflushed exit.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

async function main(): Promise<void> {
  // logger: false would also silence NestJS's own internal ExceptionHandler,
  // turning a real DI/bootstrap failure into a silent, unflushed
  // process.exit(1) with zero output — keep errors/warnings on so a bad run
  // actually explains itself.
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig('v1'));
  writeFileSync('openapi.json', JSON.stringify(document, null, 2));

  try {
    await app.close();
  } catch (error) {
    // Best-effort shutdown only: the file above is already written, which is
    // this script's entire job. Without live infra, a provider's
    // onModuleDestroy (e.g. RedisLockService quitting a client that never
    // finished connecting) can throw during teardown — that's not a reason
    // to report this run as failed.
    console.warn('Ignoring error during app.close():', error);
  }

  console.log('Wrote openapi.json');
}

main().catch((error) => {
  console.error(error);
  // Not process.exit(1): that can truncate the console.error above before it
  // flushes when stdout/stderr is piped (non-TTY) — see main.ts's
  // unhandledRejection comment for the same underlying Node behavior.
  process.exitCode = 1;
});
