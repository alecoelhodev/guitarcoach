import { AuthAfterHookContext, logAuthSecurityEvent } from './auth';
import { SecurityEventLogger } from '../observability/security-event.logger';

/**
 * `logAuthSecurityEvent` is the pure, testable core of the `hooks.after`
 * middleware wired into `createAuth` (see auth.ts for why `hooks.after` is
 * the mechanism used). These tests exercise that function directly with a
 * synthetic `ctx` shaped like Better Auth's real middleware context — they
 * verify the outcome-detection/logging logic, not a real end-to-end
 * Better Auth request. Better Auth's dispatcher stores a thrown `APIError`
 * as `ctx.context.returned` on failure (see the comment in auth.ts), which
 * is why a failure is simulated here as a plain `{ name: 'APIError' }`
 * object rather than a full response — `isAPIError` falls back to a
 * `name === 'APIError'` duck-type check for exactly this reason.
 */

type MockSecurityEventLogger = { log: jest.Mock };

function buildLogger(): MockSecurityEventLogger {
  return { log: jest.fn() };
}

function apiError(): unknown {
  return { name: 'APIError' };
}

describe('logAuthSecurityEvent', () => {
  let securityEventLogger: MockSecurityEventLogger;

  beforeEach(() => {
    securityEventLogger = buildLogger();
  });

  describe('/sign-in/email', () => {
    it('logs a success event with the signed-in user as actor', () => {
      const ctx: AuthAfterHookContext = {
        path: '/sign-in/email',
        context: {
          returned: { token: 'tok', user: { id: 'user-1' } },
        },
      };

      logAuthSecurityEvent(
        ctx,
        securityEventLogger as unknown as SecurityEventLogger,
      );

      expect(securityEventLogger.log).toHaveBeenCalledWith({
        eventType: 'auth.sign_in',
        outcome: 'success',
        actorId: 'user-1',
      });
    });

    it('logs a failure event without an actorId, to avoid leaking whether an email exists', () => {
      const ctx: AuthAfterHookContext = {
        path: '/sign-in/email',
        context: { returned: apiError() },
      };

      logAuthSecurityEvent(
        ctx,
        securityEventLogger as unknown as SecurityEventLogger,
      );

      expect(securityEventLogger.log).toHaveBeenCalledWith({
        eventType: 'auth.sign_in',
        outcome: 'failure',
        actorId: undefined,
      });
    });
  });

  describe('/admin/set-role', () => {
    it('logs a success event with the admin as actor and target user/role in detail', () => {
      const ctx: AuthAfterHookContext = {
        path: '/admin/set-role',
        body: { userId: 'target-1', role: 'admin' },
        context: {
          returned: { user: { id: 'target-1', role: 'admin' } },
          session: { user: { id: 'admin-1' } },
        },
      };

      logAuthSecurityEvent(
        ctx,
        securityEventLogger as unknown as SecurityEventLogger,
      );

      expect(securityEventLogger.log).toHaveBeenCalledWith({
        eventType: 'user.role_changed',
        outcome: 'success',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'target-1',
        detail: { role: 'admin' },
      });
    });

    it('logs a failure event when the endpoint returns an APIError', () => {
      const ctx: AuthAfterHookContext = {
        path: '/admin/set-role',
        body: { userId: 'target-1', role: 'admin' },
        context: {
          returned: apiError(),
          session: { user: { id: 'admin-1' } },
        },
      };

      logAuthSecurityEvent(
        ctx,
        securityEventLogger as unknown as SecurityEventLogger,
      );

      expect(securityEventLogger.log).toHaveBeenCalledWith({
        eventType: 'user.role_changed',
        outcome: 'failure',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'target-1',
        detail: undefined,
      });
    });
  });

  describe('/admin/ban-user', () => {
    it('logs a success event with the admin as actor and the banned user as target', () => {
      const ctx: AuthAfterHookContext = {
        path: '/admin/ban-user',
        body: { userId: 'target-1', banReason: 'abuse' },
        context: {
          returned: { user: { id: 'target-1', banned: true } },
          session: { user: { id: 'admin-1' } },
        },
      };

      logAuthSecurityEvent(
        ctx,
        securityEventLogger as unknown as SecurityEventLogger,
      );

      expect(securityEventLogger.log).toHaveBeenCalledWith({
        eventType: 'user.banned',
        outcome: 'success',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'target-1',
      });
    });
  });

  describe('/admin/unban-user', () => {
    it('logs a success event with the admin as actor and the unbanned user as target', () => {
      const ctx: AuthAfterHookContext = {
        path: '/admin/unban-user',
        body: { userId: 'target-1' },
        context: {
          returned: { user: { id: 'target-1', banned: false } },
          session: { user: { id: 'admin-1' } },
        },
      };

      logAuthSecurityEvent(
        ctx,
        securityEventLogger as unknown as SecurityEventLogger,
      );

      expect(securityEventLogger.log).toHaveBeenCalledWith({
        eventType: 'user.unbanned',
        outcome: 'success',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'target-1',
      });
    });
  });

  it('ignores paths it does not recognize', () => {
    const ctx: AuthAfterHookContext = {
      path: '/get-session',
      context: { returned: { session: {} } },
    };

    logAuthSecurityEvent(
      ctx,
      securityEventLogger as unknown as SecurityEventLogger,
    );

    expect(securityEventLogger.log).not.toHaveBeenCalled();
  });
});
