import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from '@redis/client';

// GET+DEL must run as one atomic step (Lua script) so a lock is only ever
// released by the holder that acquired it. Without this check, a holder
// whose lock already expired and was re-acquired by someone else could
// delete the new holder's lock out from under them.
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

@Injectable()
export class RedisLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);
  private readonly client: RedisClientType;

  constructor(redisUrl: string) {
    // disableOfflineQueue makes acquire/release reject immediately when the
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

  // Returns a token identifying this lock holder when acquired, or null if
  // `key` is already held by someone else. The token must be passed back to
  // `release` so only its own lock can be released.
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.client.set(key, token, {
      condition: 'NX',
      expiration: { type: 'PX', value: ttlMs },
    });

    return result === null ? null : token;
  }

  // Safe to call even if the lock already expired or was released elsewhere;
  // the CAS check in RELEASE_SCRIPT makes this a no-op in that case.
  async release(key: string, token: string): Promise<void> {
    await this.client.eval(RELEASE_SCRIPT, {
      keys: [key],
      arguments: [token],
    });
  }
}
