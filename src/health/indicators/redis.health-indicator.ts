import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { createClient, type RedisClientType } from '@redis/client';
import { EnvironmentVariables } from '../../config/env.validation';

// `connectTimeout` only bounds the raw TCP connect step (not the RESP
// handshake or the PING itself), so the whole check is additionally raced
// against this timeout to guarantee readiness never hangs on a half-open
// socket.
const CHECK_TIMEOUT_MS = 500;

/**
 * Bounded-timeout Redis connectivity check for `/health/ready`.
 *
 * Deliberately does not reuse `RedisLockService`'s long-lived client: this
 * opens a short-lived connection just to PING and closes it immediately,
 * so a probe can never interfere with the reorder lock's connection state.
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async pingCheck<Key extends string = string>(key: Key) {
    const check = this.healthIndicatorService.check(key);
    const redisUrl = this.configService.get('REDIS_URL', { infer: true });
    const client = this.createRedisClient(redisUrl);

    try {
      await this.raceWithTimeout(
        (async () => {
          await client.connect();
          await client.ping();
        })(),
      );
      return check.up();
    } catch (error) {
      // Log full detail server-side only; the public health result must not
      // leak connection strings or raw error objects.
      this.logger.error('Redis readiness check failed', error as Error);
      return check.down('unreachable');
    } finally {
      // Sync and unconditional: safe to call whether or not connect()
      // ever succeeded, unlike quit()/close() which expect a live socket.
      client.destroy();
    }
  }

  // Extracted so unit tests can substitute a fake client (via a subclass
  // override) instead of module-mocking `@redis/client`.
  protected createRedisClient(url: string): RedisClientType {
    return createClient({
      url,
      socket: { connectTimeout: CHECK_TIMEOUT_MS, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
  }

  private raceWithTimeout(promise: Promise<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)),
        CHECK_TIMEOUT_MS,
      );
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }
}
