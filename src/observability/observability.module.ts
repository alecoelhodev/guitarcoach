import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { EnvironmentVariables } from '../config/env.validation';
import { HttpExceptionFilter } from './http-exception.filter';
import { HttpObservabilityInterceptor } from './http-observability.interceptor';
import { MetricsModule } from './metrics/metrics.module';
import { SecurityEventLogger } from './security-event.logger';
import {
  createStructuredLogger,
  StructuredLoggerService,
} from './structured-logger.service';

/**
 * Cross-cutting observability infra (structured logging, correlation
 * context, response normalization, security events, metrics) — global like
 * `RedisLockModule`/`PrismaModule`, since every feature module needs the
 * logger and most need `SecurityEventLogger`.
 */
@Global()
@Module({
  imports: [MetricsModule],
  providers: [
    {
      provide: StructuredLoggerService,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) =>
        createStructuredLogger(configService),
    },
    SecurityEventLogger,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpObservabilityInterceptor },
  ],
  exports: [StructuredLoggerService, SecurityEventLogger],
})
export class ObservabilityModule {}
