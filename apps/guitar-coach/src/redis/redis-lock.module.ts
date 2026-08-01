import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { RedisLockService } from './redis-lock.service';

@Global()
@Module({
  providers: [
    {
      provide: RedisLockService,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) =>
        new RedisLockService(configService.get('REDIS_URL', { infer: true })),
    },
  ],
  exports: [RedisLockService],
})
export class RedisLockModule {}
