import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import * as amqp from 'amqplib';
import { EnvironmentVariables } from '../../config/env.validation';

// amqplib's own `timeout` socket option bounds both the TCP connect and the
// AMQP handshake (it's only cleared once the connection is fully open), so
// no extra Promise.race is needed on top of it.
const CONNECT_TIMEOUT_MS = 500;

/**
 * Bounded-timeout RabbitMQ connectivity check for `/health/ready`.
 *
 * Deliberately standalone: opens a short-lived connection and closes it
 * immediately, rather than reusing the `routine.created` producer/consumer's
 * `ClientProxy`/microservice connection.
 */
@Injectable()
export class RabbitmqHealthIndicator {
  private readonly logger = new Logger(RabbitmqHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async pingCheck<Key extends string = string>(key: Key) {
    const check = this.healthIndicatorService.check(key);
    const rabbitmqUrl = this.configService.get('RABBITMQ_URL', {
      infer: true,
    });
    let connection: amqp.ChannelModel | undefined;

    try {
      connection = await this.connect(rabbitmqUrl);
      return check.up();
    } catch (error) {
      // Log full detail server-side only; the public health result must not
      // leak connection strings or raw error objects.
      this.logger.error('RabbitMQ readiness check failed', error as Error);
      return check.down('unreachable');
    } finally {
      await connection?.close().catch((error: Error) => {
        this.logger.warn(
          'Failed to close RabbitMQ health-check connection',
          error,
        );
      });
    }
  }

  // Extracted so unit tests can substitute a fake connection (via a
  // subclass override) instead of module-mocking `amqplib`.
  protected connect(url: string): Promise<amqp.ChannelModel> {
    return amqp.connect(url, { timeout: CONNECT_TIMEOUT_MS });
  }
}
