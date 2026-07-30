import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { RedisRateLimitStorage } from './redis-rate-limit-storage';

@Global()
@Module({
  providers: [
    {
      provide: RedisRateLimitStorage,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) =>
        new RedisRateLimitStorage(
          configService.get('REDIS_URL', { infer: true }),
        ),
    },
  ],
  exports: [RedisRateLimitStorage],
})
export class RedisRateLimitStorageModule {}
