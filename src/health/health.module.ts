import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RabbitmqHealthIndicator } from './indicators/rabbitmq.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, RabbitmqHealthIndicator],
})
export class HealthModule {}
