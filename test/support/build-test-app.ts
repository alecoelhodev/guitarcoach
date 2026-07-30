import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppConfigModule } from '../../src/config/app-config.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { RoutinesModule } from '../../src/routines/routines.module';
import { TasksModule } from '../../src/tasks/tasks.module';
import { UsersModule } from '../../src/users/users.module';
import { FakeAuthGuard } from './fake-auth.guard';

/**
 * Builds the same controller/service/Prisma wiring as AppModule, but swaps
 * the real Better-Auth-backed global AuthGuard for FakeAuthGuard, which
 * reads the exact same PUBLIC/OPTIONAL/ROLES reflector metadata the real
 * guard reads. Lets e2e specs drive auth via the x-test-role header (see
 * requestAs in ./request-as) instead of a real Better Auth sign-in flow.
 */
export async function buildTestApp(): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      PrismaModule,
      UsersModule,
      TasksModule,
      RoutinesModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: FakeAuthGuard }],
  }).compile();

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
