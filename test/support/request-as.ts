import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { TEST_ROLE_HEADER, TEST_USER_ID_HEADER } from './fake-auth.guard';

/**
 * supertest requests pre-tagged with the x-test-role header FakeAuthGuard
 * reads. Omit `role` to simulate an unauthenticated request. Pass `userId`
 * to simulate a specific authenticated user (defaults to a fixed test user
 * id in FakeAuthGuard) — needed for specs that assert per-user ownership.
 */
export function requestAs(
  app: INestApplication<App>,
  role?: string,
  userId?: string,
) {
  const agent = request(app.getHttpServer());
  const withRole = <T extends request.Test>(req: T): T => {
    if (!role) return req;
    req.set(TEST_ROLE_HEADER, role);
    if (userId) req.set(TEST_USER_ID_HEADER, userId);
    return req;
  };

  return {
    get: (url: string) => withRole(agent.get(url)),
    post: (url: string) => withRole(agent.post(url)),
    patch: (url: string) => withRole(agent.patch(url)),
    delete: (url: string) => withRole(agent.delete(url)),
  };
}
