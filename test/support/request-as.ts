import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { TEST_ROLE_HEADER } from './fake-auth.guard';

/**
 * supertest requests pre-tagged with the x-test-role header FakeAuthGuard
 * reads. Omit `role` to simulate an unauthenticated request.
 */
export function requestAs(app: INestApplication<App>, role?: string) {
  const agent = request(app.getHttpServer());
  const withRole = <T extends request.Test>(req: T): T =>
    role ? req.set(TEST_ROLE_HEADER, role) : req;

  return {
    get: (url: string) => withRole(agent.get(url)),
    post: (url: string) => withRole(agent.post(url)),
    patch: (url: string) => withRole(agent.patch(url)),
    delete: (url: string) => withRole(agent.delete(url)),
  };
}
