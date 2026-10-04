import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { GcpStorageService } from './../src/gcp-storage/gcp-storage.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { buildTestApp } from './support/build-test-app';
import { FakeGcpStorageService } from './support/fake-gcp-storage.service';
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
    await prisma.recording.deleteMany();
    await prisma.practiceSessionTask.deleteMany();
    await prisma.practiceSession.deleteMany();
    await prisma.routineTask.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.task.deleteMany();
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

    it('returns 400 when the id is not a UUID', async () => {
      await admin().get('/api/v1/users/not-a-uuid').expect(400);
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

  describe('DELETE /api/v1/users/me', () => {
    // Seeds a user owning one of everything a deletion has to clear,
    // including an object in the fake bucket.
    const seedOwner = async (email: string) => {
      const user = await seedUser({ email, displayName: email });
      const task = await prisma.task.create({
        data: { title: `Task for ${email}` },
      });
      const routine = await prisma.routine.create({
        data: { userId: user.id, title: 'Morning' },
      });
      await prisma.routineTask.create({
        data: { routineId: routine.id, taskId: task.id, position: 0 },
      });
      const session = await prisma.practiceSession.create({
        data: { userId: user.id, routineId: routine.id },
      });
      await prisma.practiceSessionTask.create({
        data: { practiceSessionId: session.id, taskId: task.id },
      });
      const objectName = `users/${user.id}/practice-sessions/${session.id}/x-take.m4a`;
      await prisma.recording.create({
        data: {
          userId: user.id,
          practiceSessionId: session.id,
          objectName,
          originalFileName: 'take.m4a',
          contentType: 'audio/mp4',
          sizeBytes: 3,
        },
      });
      const storage: FakeGcpStorageService = app.get(GcpStorageService);
      storage.objects.set(objectName, Buffer.from('abc'));
      return { user, task, objectName, storage };
    };

    it('deletes the caller and everything they own, and nothing else', async () => {
      const me = await seedOwner('me@example.com');
      const other = await seedOwner('other@example.com');

      await requestAs(app, 'user', me.user.id)
        .delete('/api/v1/users/me')
        .expect(204);

      expect(
        await prisma.user.findUnique({ where: { id: me.user.id } }),
      ).toBeNull();
      expect(
        await prisma.routine.count({ where: { userId: me.user.id } }),
      ).toBe(0);
      expect(
        await prisma.practiceSession.count({ where: { userId: me.user.id } }),
      ).toBe(0);
      expect(
        await prisma.recording.count({ where: { userId: me.user.id } }),
      ).toBe(0);
      expect(me.storage.objects.has(me.objectName)).toBe(false);

      // Shared tasks and the other account survive untouched.
      expect(await prisma.task.count({ where: { id: me.task.id } })).toBe(1);
      expect(
        await prisma.routine.count({ where: { userId: other.user.id } }),
      ).toBe(1);
      expect(
        await prisma.practiceSession.count({
          where: { userId: other.user.id },
        }),
      ).toBe(1);
      expect(other.storage.objects.has(other.objectName)).toBe(true);
    });

    it('is open to ordinary users, not just admins', async () => {
      const created = await seedUser();

      await requestAs(app, 'user', created.id)
        .delete('/api/v1/users/me')
        .expect(204);
    });

    it('returns 401 without a session', async () => {
      await requestAs(app).delete('/api/v1/users/me').expect(401);
    });
  });
});
