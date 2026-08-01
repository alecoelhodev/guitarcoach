import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin } from 'better-auth/plugins';
import type { PrismaService } from '../prisma/prisma.service';
import { sendResetPasswordEmail, sendVerificationEmail } from './email';
import type { RedisRateLimitStorage } from './redis-rate-limit-storage';

export function createAuth(
  prisma: PrismaService,
  redisRateLimitStorage: RedisRateLimitStorage,
) {
  return betterAuth({
    basePath: '/auth',
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    advanced: {
      database: { generateId: false },
    },
    user: {
      fields: { name: 'displayName' },
    },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: sendResetPasswordEmail,
    },
    emailVerification: {
      sendVerificationEmail,
      sendOnSignUp: true,
    },
    // Wired as `rateLimit.customStorage`, NOT `secondaryStorage` — the latter
    // is also read by session/verification-token caching regardless of the
    // rate limiter's own storage setting, which would leak session data
    // (including PII) into Redis. `customStorage` keeps Redis scoped to
    // rate-limit counters only; sessions/verification stay in Postgres.
    rateLimit: {
      enabled: true,
      customStorage: redisRateLimitStorage,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
      },
    },
    plugins: [
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
