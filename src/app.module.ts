import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import KeyvRedis from '@keyv/redis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { createAuth } from './auth/auth';
import { RedisRateLimitStorage } from './auth/redis-rate-limit-storage';
import { RedisRateLimitStorageModule } from './auth/redis-rate-limit-storage.module';
import { AppConfigModule } from './config/app-config.module';
import { EnvironmentVariables } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { RedisLockModule } from './redis/redis-lock.module';
import { RoutinesModule } from './routines/routines.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisRateLimitStorageModule,
    RedisLockModule,
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ) => ({
        stores: [
          new KeyvRedis(configService.get('REDIS_URL', { infer: true })),
        ],
        ttl: configService.get('CACHE_TTL_MS', { infer: true }),
      }),
    }),
    AuthModule.forRootAsync({
      inject: [PrismaService, RedisRateLimitStorage],
      useFactory: (
        prisma: PrismaService,
        redisRateLimitStorage: RedisRateLimitStorage,
      ) => ({ auth: createAuth(prisma, redisRateLimitStorage) }),
    }),
    HealthModule,
    UsersModule,
    TasksModule,
    RoutinesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
