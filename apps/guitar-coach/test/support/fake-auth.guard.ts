import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

export const TEST_ROLE_HEADER = 'x-test-role';
export const TEST_USER_ID_HEADER = 'x-test-user-id';
const DEFAULT_TEST_USER_ID = 'test-user-id';

/**
 * Test double for @thallesp/nestjs-better-auth's global AuthGuard. Replaces
 * the real Better Auth session lookup with a role read from a header, but
 * reads the exact same PUBLIC/OPTIONAL/ROLES reflector metadata the real
 * guard reads — so an e2e test using this guard fails the same way it would
 * against the real guard if a @Roles() decorator is weakened or removed.
 */
@Injectable()
export class FakeAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { session?: unknown; user?: unknown }>();
    const role = request.headers[TEST_ROLE_HEADER] as string | undefined;
    const userId =
      (request.headers[TEST_USER_ID_HEADER] as string | undefined) ??
      DEFAULT_TEST_USER_ID;

    const isPublic = this.reflector.getAllAndOverride<boolean>('PUBLIC', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isOptional = this.reflector.getAllAndOverride<boolean>('OPTIONAL', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!role) {
      if (isOptional) return true;
      throw new UnauthorizedException();
    }

    const user = { id: userId, role };
    request.session = { user };
    request.user = user;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>('ROLES', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles?.length && !requiredRoles.includes(role)) {
      throw new ForbiddenException();
    }

    return true;
  }
}
