import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { App } from 'supertest/types';
import { ACTIVITY_FEED_CLIENT } from '../../src/activity-feed/activity-feed.constants';
import { ActivityFeedModule } from '../../src/activity-feed/activity-feed.module';
import { AppConfigModule } from '../../src/config/app-config.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { RedisLockModule } from '../../src/redis/redis-lock.module';
import { RoutinesModule } from '../../src/routines/routines.module';
import { TasksModule } from '../../src/tasks/tasks.module';
import { UsersModule } from '../../src/users/users.module';
import { FakeAuthGuard } from './fake-auth.guard';

/**
 * Mock for ACTIVITY_FEED_CLIENT (a ClientProxy) — e2e tests never need a
 * real RabbitMQ round-trip for either the routine.created producer (emit)
 * or the activity-feed controller (send). `emit`/`send` default to emitting
 * an empty observable; individual specs override the mock's return value
 * (e.g. `app.get(ACTIVITY_FEED_CLIENT).send.mockReturnValue(of(canned))`).
 */
export function createActivityFeedClientMock() {
  return {
    emit: jest.fn().mockReturnValue(of(undefined)),
    send: jest.fn().mockReturnValue(of([])),
  };
}

/**
 * Builds the same controller/service/Prisma wiring as AppModule, but swaps
 * the real Better-Auth-backed global AuthGuard for FakeAuthGuard, which
 * reads the exact same PUBLIC/OPTIONAL/ROLES reflector metadata the real
 * guard reads. Lets e2e specs drive auth via the x-test-role header (see
 * requestAs in ./request-as) instead of a real Better Auth sign-in flow.
 *
 * Uses CacheModule's default in-memory store rather than AppModule's Redis
 * store — TasksService's cache-aside logic is store-agnostic, and each test
 * gets a fresh app (and therefore a fresh cache) via beforeEach, so this
 * avoids requiring a running Redis for response caching in e2e runs.
 *
 * RedisLockModule is still the real Redis-backed one (no in-memory
 * substitute exists for it): RoutinesService's reorder lock needs the
 * atomic SET NX/CAS-release semantics only a real Redis provides. REDIS_URL
 * is already a required env var (see env.validation.ts) and the Redis
 * container is already expected to be running for local/e2e use, same as
 * TEST_DATABASE_URL's Postgres container.
 */
export async function buildTestApp(): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      CacheModule.register({ isGlobal: true }),
      PrismaModule,
      RedisLockModule,
      UsersModule,
      TasksModule,
      RoutinesModule,
      ActivityFeedModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: FakeAuthGuard }],
  })
    .overrideProvider(ACTIVITY_FEED_CLIENT)
    .useValue(createActivityFeedClientMock())
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  return app;
}
