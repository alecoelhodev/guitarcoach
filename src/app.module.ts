import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import KeyvRedis from '@keyv/redis';
import type { RedisClientOptions } from '@redis/client';
import { AiPracticePlannerModule } from './ai-practice-planner/ai-practice-planner.module';
import { AiRoutineCoachModule } from './ai-routine-coach/ai-routine-coach.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { createAuth } from './auth/auth';
import { RedisRateLimitStorage } from './auth/redis-rate-limit-storage';
import { RedisRateLimitStorageModule } from './auth/redis-rate-limit-storage.module';
import { AppConfigModule } from './config/app-config.module';
import { EnvironmentVariables } from './config/env.validation';
import { GcpStorageModule } from './gcp-storage/gcp-storage.module';
import { HealthModule } from './health/health.module';
import { PracticeSessionsModule } from './practice-sessions/practice-sessions.module';
import { ObservabilityModule } from './observability/observability.module';
import { SecurityEventLogger } from './observability/security-event.logger';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { RedisLockModule } from './redis/redis-lock.module';
import { RoutinesModule } from './routines/routines.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    PrismaModule,
    GcpStorageModule,
    RedisRateLimitStorageModule,
    RedisLockModule,
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ) => ({
        stores: [
          // disableOfflineQueue + a bounded connectionTimeout keep a Redis
          // outage from hanging cache reads/writes; TasksService's
          // safeCacheGet/Set/Del already fail open on a rejection, but that
          // only helps once the underlying call actually rejects instead of
          // queuing forever.
          new KeyvRedis(
            {
              url: configService.get('REDIS_URL', { infer: true }),
              socket: { connectTimeout: 2000 },
              disableOfflineQueue: true,
            } satisfies RedisClientOptions,
            { connectionTimeout: 2000, throwOnConnectError: false },
          ),
        ],
        ttl: configService.get('CACHE_TTL_MS', { infer: true }),
      }),
    }),
    AuthModule.forRootAsync({
      inject: [
        PrismaService,
        RedisRateLimitStorage,
        SecurityEventLogger,
        ConfigService,
      ],
      useFactory: (
        prisma: PrismaService,
        redisRateLimitStorage: RedisRateLimitStorage,
        securityEventLogger: SecurityEventLogger,
        configService: ConfigService<EnvironmentVariables, true>,
      ) => ({
        auth: createAuth(
          prisma,
          redisRateLimitStorage,
          securityEventLogger,
          configService.get('CORS_ORIGINS', { infer: true }),
        ),
      }),
    }),
    HealthModule,
    UsersModule,
    TasksModule,
    RoutinesModule,
    PracticeSessionsModule,
    AiPracticePlannerModule,
    AiRoutineCoachModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
