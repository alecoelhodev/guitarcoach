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
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (error: Error) => {
      this.logger.error('Redis client error', error);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
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
    const [count, ttl] = (await this.client.eval(CONSUME_SCRIPT, {
      keys: [key],
      arguments: [rule.window.toString()],
    })) as [number, number];

    if (count <= rule.max) {
      return { allowed: true, retryAfter: null };
    }
    return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
  }
}
