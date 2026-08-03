import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppConfigModule } from '../../src/config/app-config.module';
import { GcpStorageModule } from '../../src/gcp-storage/gcp-storage.module';
import { GcpStorageService } from '../../src/gcp-storage/gcp-storage.service';
import { PracticeSessionsModule } from '../../src/practice-sessions/practice-sessions.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { RedisLockModule } from '../../src/redis/redis-lock.module';
import { RoutinesModule } from '../../src/routines/routines.module';
import { TasksModule } from '../../src/tasks/tasks.module';
import { UsersModule } from '../../src/users/users.module';
import { FakeAuthGuard } from './fake-auth.guard';
import { FakeGcpStorageService } from './fake-gcp-storage.service';

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
 *
 * GcpStorageService is swapped for an in-memory FakeGcpStorageService so
 * e2e specs never make real GCS calls or need real bucket credentials.
 */
export async function buildTestApp(): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      CacheModule.register({ isGlobal: true }),
      PrismaModule,
      GcpStorageModule,
      RedisLockModule,
      UsersModule,
      TasksModule,
      RoutinesModule,
      PracticeSessionsModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: FakeAuthGuard }],
  })
    .overrideProvider(GcpStorageService)
    .useClass(FakeGcpStorageService)
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
