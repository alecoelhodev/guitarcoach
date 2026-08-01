import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from '@redis/client';
import type { BetterAuthRateLimitStorage, RateLimit } from 'better-auth';

// INCR + EXPIRE must run as one atomic step so concurrent requests can't both
// observe count 1 and each (re)apply the TTL, which would keep resetting the
// rate-limit window and let a burst through indefinitely. Returning the TTL
// alongside the count lets `consume` compute `retryAfter` without a second
// round trip.
const CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {count, ttl}
`;

// Registered as `rateLimit.customStorage`, not `secondaryStorage` — the latter
// is also read by Better Auth's session/verification-token caching regardless
// of the rate limiter's own storage setting, which would leak session data
// (including PII) into Redis. `customStorage` is structurally independent of
// `secondaryStorage`, so this keeps Redis scoped to rate-limit counters only.
@Injectable()
export class RedisRateLimitStorage
  implements BetterAuthRateLimitStorage, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisRateLimitStorage.name);
  private readonly client: RedisClientType;

  constructor(redisUrl: string) {
    // disableOfflineQueue makes consume/get/set reject immediately when the
    // socket isn't ready instead of queuing forever while it reconnects in
    // the background — the default reconnectStrategy is left untouched so
    // the client keeps retrying and reconnects automatically once Redis is
    // back, with no extra reconnect-on-demand logic needed here.
    this.client = createClient({
      url: redisUrl,
      socket: { connectTimeout: 2000 },
      disableOfflineQueue: true,
    });
    this.client.on('error', (error: Error) => {
      this.logger.error('Redis client error', error);
    });
  }

  // Bounded so a Redis outage at container startup can't block Nest's
  // bootstrap forever — the underlying connect attempt keeps retrying in the
  // background (see constructor) even if this wait times out.
  async onModuleInit(): Promise<void> {
    await Promise.race([
      this.client.connect().catch((error: Error) => {
        this.logger.warn('Redis connect failed at startup', error);
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  // Legacy fallback path, only used if `consume` were absent — kept for
  // interface completeness, not exercised while `consume` is implemented.
  async get(key: string): Promise<RateLimit | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as RateLimit) : null;
  }

  async set(key: string, value: RateLimit): Promise<void> {
    await this.client.set(key, JSON.stringify(value));
  }

  async consume(
    key: string,
    rule: { window: number; max: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }> {
    // Fail open: rate limiting is a non-critical guard, and Better Auth
    // awaits this call inline with no timeout of its own, so a Redis outage
    // must not block every sign-in/sign-up request.
    try {
      const [count, ttl] = (await this.client.eval(CONSUME_SCRIPT, {
        keys: [key],
        arguments: [rule.window.toString()],
      })) as [number, number];

      if (count <= rule.max) {
        return { allowed: true, retryAfter: null };
      }
      return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
    } catch (error) {
      this.logger.warn(
        `Rate limit check failed for key "${key}"; allowing request`,
        error,
      );
      return { allowed: true, retryAfter: null };
    }
  }
}
