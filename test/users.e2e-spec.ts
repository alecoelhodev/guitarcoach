import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { buildTestApp } from './support/build-test-app';
import { requestAs } from './support/request-as';

interface UserResponseBody {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

describe('UsersController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    app = await buildTestApp();

    prisma = app.get(PrismaService);
    await prisma.routineTask.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  // Admin-only per @Roles(['admin']) on UsersController; RBAC enforcement
  // itself is covered by test/rbac.e2e-spec.ts, so these requests always
  // authenticate as admin to exercise CRUD behavior.
  const admin = () => requestAs(app, 'admin');

  // Users are created via Better Auth's sign-up flow, not this API, so
  // fixtures are seeded directly through Prisma.
  const seedUser = (overrides: { email?: string; displayName?: string } = {}) =>
    prisma.user.create({
      data: {
        email: overrides.email ?? 'jordan@example.com',
        displayName: overrides.displayName ?? 'Jordan',
      },
    });

  describe('GET /api/v1/users', () => {
    it('returns an array of users', async () => {
      await seedUser();

      const response = await admin().get('/api/v1/users').expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('returns the user when found', async () => {
      const created = await seedUser();

      const response = await admin()
        .get(`/api/v1/users/${created.id}`)
        .expect(200);

      expect((response.body as UserResponseBody).id).toBe(created.id);
    });

    it('returns 404 when the user does not exist', async () => {
      await admin()
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/users/:id', () => {
    it('updates the user', async () => {
      const created = await seedUser();

      const response = await admin()
        .patch(`/api/v1/users/${created.id}`)
        .send({ displayName: 'Jordan Casey' })
        .expect(200);

      expect((response.body as UserResponseBody).displayName).toBe(
        'Jordan Casey',
      );
    });

    it('returns 409 when updating to another user email', async () => {
      await seedUser({ email: 'a@example.com', displayName: 'AA' });
      const userB = await seedUser({
        email: 'b@example.com',
        displayName: 'BB',
      });

      await admin()
        .patch(`/api/v1/users/${userB.id}`)
        .send({ email: 'a@example.com' })
        .expect(409);
    });

    it('returns 404 when the user does not exist', async () => {
      await admin()
        .patch('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .send({ displayName: 'Jordan Casey' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/users/:id', () => {
    it('deletes the user and returns 204', async () => {
      const created = await seedUser();

      await admin().delete(`/api/v1/users/${created.id}`).expect(204);

      await admin().get(`/api/v1/users/${created.id}`).expect(404);
    });

    it('returns 404 when the user does not exist', async () => {
      await admin()
        .delete('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
