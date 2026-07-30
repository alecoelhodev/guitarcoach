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
