import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { EnvironmentVariables } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitmqHealthIndicator } from './indicators/rabbitmq.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

const DISK_THRESHOLD_PERCENT = 0.9;

// Terminus defaults this ping to 1000ms, which is shorter than Neon's
// scale-to-zero wake — the first check after ~5 minutes idle would report the
// database down purely on cold start. See docs/deployment.md.
const DATABASE_PING_TIMEOUT_MS = 3000;

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly db: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly rabbitmq: RabbitmqHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Get('live')
  @AllowAnonymous()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  @Get('ready')
  @AllowAnonymous()
  @HealthCheck()
  readiness() {
    const heapThresholdBytes = this.configService.get(
      'HEALTH_MEMORY_HEAP_THRESHOLD_BYTES',
      { infer: true },
    );
    const rssThresholdBytes = this.configService.get(
      'HEALTH_MEMORY_RSS_THRESHOLD_BYTES',
      { infer: true },
    );

    return this.health.check([
      () => this.memory.checkHeap('memory_heap', heapThresholdBytes),
      () => this.memory.checkRSS('memory_rss', rssThresholdBytes),
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: DISK_THRESHOLD_PERCENT,
        }),
      () =>
        this.db.pingCheck('database', this.prisma, {
          timeout: DATABASE_PING_TIMEOUT_MS,
        }),
      () => this.redis.pingCheck('redis'),
      () => this.rabbitmq.pingCheck('rabbitmq'),
    ]);
  }
}
