import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/env.validation';
import { correlationIdMiddleware } from './observability/correlation-id.middleware';
import { StructuredLoggerService } from './observability/structured-logger.service';
import { routineEventsRmqOptions } from './routines/events/rabbitmq.constants';
import { buildSwaggerConfig } from './swagger.config';

// @openai/agents-core's TraceProvider installs its own process-wide
// 'unhandledRejection' listener (dist/tracing/provider.js) that calls
// process.exit(1) whenever it's the only listener for the event — so any
// stray unhandled rejection anywhere in the app, unrelated to AI features,
// would otherwise force-exit the whole process, and process.exit() truncates
// whatever we were about to log about the real error before it flushes.
// Registering a listener here defuses that exit branch (Node calls every
// registered listener) and guarantees the actual rejection reason is logged.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

async function bootstrap(): Promise<void> {
  // bufferLogs holds every log emitted during module initialization until
  // useLogger() below is called, so even early bootstrap/DI logs go through
  // the structured logger instead of Nest's default console logger.
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  const configService = app.get(ConfigService<EnvironmentVariables, true>);

  app.useLogger(app.get(StructuredLoggerService));
  // Registered before the auth guard sees any request, so every request —
  // including ones that fail authentication — gets a correlated request ID.
  app.use(correlationIdMiddleware);

  const apiPrefix = configService.get('API_PREFIX', { infer: true });
  const apiVersion = configService.get('API_VERSION', { infer: true });
  const port = configService.get('PORT', { infer: true });

  // Runs the routine.created consumer in-process alongside the HTTP server
  // (hybrid app) — this repo has no separate worker deployable. Must be
  // connected and started before app.listen(), per Nest's documented
  // hybrid-application bootstrap order.
  app.connectMicroservice(
    routineEventsRmqOptions(configService.get('RABBITMQ_URL', { infer: true })),
  );
  await app.startAllMicroservices();

  app.setGlobalPrefix(`${apiPrefix}/${apiVersion}`, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'auth', method: RequestMethod.ALL },
      { path: 'auth/*path', method: RequestMethod.ALL },
    ],
  });
  app.enableCors();
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = buildSwaggerConfig(apiVersion);
  const swaggerDocument = () =>
    SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(port);

  const url = await app.getUrl();
  console.log(`Application is running on: ${url}`);
}
void bootstrap();
