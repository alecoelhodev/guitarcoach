import { NestFactory } from '@nestjs/core';
import { activityFeedRmqOptions } from './activity-feed/activity-feed.constants';
import { AppModule } from './app.module';
import { validate } from './config/env.validation';

async function bootstrap(): Promise<void> {
  // NestFactory.createMicroservice() needs its RMQ options synchronously,
  // before the Nest module graph (and therefore ConfigModule) exists, so
  // there's no ConfigService to read RABBITMQ_URL from yet. Validate the
  // raw environment directly with the same Zod schema/validate() that
  // ConfigModule.forRoot({ validate }) uses in app.module.ts, so validation
  // is never skipped — just performed earlier, from a single source of
  // truth for the schema. ConfigModule re-validates when the module graph
  // is built right after; that second pass is cheap and harmless.
  const env = validate(process.env);

  const app = await NestFactory.createMicroservice(
    AppModule,
    activityFeedRmqOptions(env.RABBITMQ_URL),
  );

  await app.listen();
}
void bootstrap();
