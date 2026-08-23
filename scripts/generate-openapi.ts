import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { EnvironmentVariables } from '../src/config/env.validation';
import { applyGlobalPrefix } from '../src/global-prefix';
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
  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const apiPrefix = configService.get('API_PREFIX', { infer: true });
  const apiVersion = configService.get('API_VERSION', { infer: true });

  // createDocument() reads whatever prefix has been applied to the app, so
  // this has to happen first — without it the document's paths would be the
  // unprefixed controller routes ('/tasks'), not the ones the app serves
  // ('/api/v1/tasks'), and a generated client would call the wrong URLs.
  // Applied via the same helper main.ts uses, so the exclusions
  // (health probes, Better Auth) can't drift between the two.
  applyGlobalPrefix(app, apiPrefix, apiVersion);

  const document = SwaggerModule.createDocument(
    app,
    buildSwaggerConfig(apiVersion),
  );
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
