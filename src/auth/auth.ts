import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import type { SecurityEventLogger } from '../observability/security-event.logger';
import type { PrismaService } from '../prisma/prisma.service';
import { sendResetPasswordEmail, sendVerificationEmail } from './email';
import type { RedisRateLimitStorage } from './redis-rate-limit-storage';

/**
 * Narrowed-down shape of the `hooks.after` middleware context this module
 * reads from — Better Auth's real context type is much larger (see
 * `createAuthMiddleware`'s signature in `better-auth/api`), but only these
 * fields matter here. Keeping this as its own interface lets
 * `logAuthSecurityEvent` be unit-tested with a plain object instead of a
 * real Better Auth request/response round-trip.
 */
export interface AuthAfterHookContext {
  path: string;
  body?: Record<string, unknown> | null;
  context: {
    returned?: unknown;
    session?: { user?: { id?: string } } | null;
  };
}

function extractUserId(returned: unknown): string | undefined {
  if (!returned || typeof returned !== 'object' || !('user' in returned)) {
    return undefined;
  }
  const user = (returned as { user?: unknown }).user;
  if (!user || typeof user !== 'object' || !('id' in user)) {
    return undefined;
  }
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function targetUserId(ctx: AuthAfterHookContext): string | undefined {
  const userId = ctx.body?.userId;
  return typeof userId === 'string' ? userId : undefined;
}

/**
 * Observes the outcome of security-relevant Better Auth endpoints and
 * forwards it to `SecurityEventLogger`.
 *
 * `hooks.after` (the only hook point in Better Auth 1.6.x's own middleware
 * system that runs post-outcome rather than pre-request) fires for every
 * request; `ctx.path` narrows it to the endpoints this covers. On failure,
 * Better Auth's dispatcher catches the endpoint's thrown `APIError` and
 * stores it as `ctx.context.returned` before running `after` hooks — see
 * `runAfterHooks`/`dispatchAuthEndpoint` in `better-auth/dist/api/dispatch` —
 * so `isAPIError(returned)` is how this module distinguishes failure from
 * success without guessing at a different mechanism.
 */
export function logAuthSecurityEvent(
  ctx: AuthAfterHookContext,
  securityEventLogger: SecurityEventLogger,
): void {
  const returned = ctx.context.returned;
  const failed = isAPIError(returned);

  switch (ctx.path) {
    case '/sign-in/email':
      securityEventLogger.log({
        eventType: 'auth.sign_in',
        outcome: failed ? 'failure' : 'success',
        // Never set actorId on failure — the requester may not correspond
        // to a real account, and echoing one back would leak whether an
        // email address exists.
        actorId: failed ? undefined : extractUserId(returned),
      });
      return;
    case '/admin/set-role':
      securityEventLogger.log({
        eventType: 'user.role_changed',
        outcome: failed ? 'failure' : 'success',
        actorId: ctx.context.session?.user?.id,
        targetType: 'user',
        targetId: targetUserId(ctx),
        detail: failed ? undefined : { role: ctx.body?.role },
      });
      return;
    case '/admin/ban-user':
      securityEventLogger.log({
        eventType: 'user.banned',
        outcome: failed ? 'failure' : 'success',
        actorId: ctx.context.session?.user?.id,
        targetType: 'user',
        targetId: targetUserId(ctx),
      });
      return;
    case '/admin/unban-user':
      securityEventLogger.log({
        eventType: 'user.unbanned',
        outcome: failed ? 'failure' : 'success',
        actorId: ctx.context.session?.user?.id,
        targetType: 'user',
        targetId: targetUserId(ctx),
      });
      return;
    default:
      return;
  }
}

export function createAuth(
  prisma: PrismaService,
  redisRateLimitStorage: RedisRateLimitStorage,
  securityEventLogger: SecurityEventLogger,
  trustedOrigins: string[],
) {
  return betterAuth({
    basePath: '/auth',
    // The same CORS_ORIGINS list main.ts hands to enableCors(). Better Auth's
    // originCheckMiddleware otherwise trusts only BETTER_AUTH_URL's own origin
    // and answers 403 INVALID_ORIGIN to a cookie-bearing non-GET from anywhere
    // else — passing CORS but failing the request it was meant to allow.
    trustedOrigins,
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
    // See `logAuthSecurityEvent` above for why `hooks.after` (rather than
    // `databaseHooks`) is the mechanism used to observe sign-in/admin
    // outcomes for security-event logging.
    hooks: {
      after: createAuthMiddleware((ctx) => {
        logAuthSecurityEvent(ctx, securityEventLogger);
        return Promise.resolve();
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
