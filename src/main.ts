import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/env.validation';
import { routineEventsRmqOptions } from './routines/events/rabbitmq.constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService<EnvironmentVariables, true>);

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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Guitar Coach API')
    .setDescription('API documentation for the Guitar Coach backend')
    .setVersion(apiVersion)
    .build();
  const swaggerDocument = () =>
    SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(port);

  const url = await app.getUrl();
  console.log(`Application is running on: ${url}`);
}
void bootstrap();
