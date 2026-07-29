import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { buildTestApp } from './support/build-test-app';
import { requestAs } from './support/request-as';

/**
 * Guards against a developer weakening or deleting a @Roles(['admin'])
 * decorator on UsersController/TasksController. See
 * test/support/fake-auth.guard.ts for how auth is faked.
 */
describe('Role-based access control (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    app = await buildTestApp();

    prisma = app.get(PrismaService);
    await prisma.routineTask.deleteMany();
    await prisma.task.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (role?: string) => requestAs(app, role);

  const seedTask = () =>
    prisma.task.create({ data: { title: 'Chromatic warm-up' } });

  const seedUser = () =>
    prisma.user.create({
      data: { email: 'jordan@example.com', displayName: 'Jordan' },
    });

  describe('TasksController', () => {
    it('rejects unauthenticated requests to admin-only routes', async () => {
      const task = await seedTask();

      await as().post('/api/v1/tasks').send({ title: 'New task' }).expect(401);
      await as().patch(`/api/v1/tasks/${task.id}`).send({}).expect(401);
      await as().delete(`/api/v1/tasks/${task.id}`).expect(401);
    });

    it('rejects a non-admin user on admin-only routes', async () => {
      const task = await seedTask();

      await as('user')
        .post('/api/v1/tasks')
        .send({ title: 'New task' })
        .expect(403);
      await as('user')
        .patch(`/api/v1/tasks/${task.id}`)
        .send({ title: 'Renamed' })
        .expect(403);
      await as('user').delete(`/api/v1/tasks/${task.id}`).expect(403);
    });

    it('allows an admin on admin-only routes', async () => {
      const task = await seedTask();

      await as('admin')
        .post('/api/v1/tasks')
        .send({ title: 'New task' })
        .expect(201);
      await as('admin')
        .patch(`/api/v1/tasks/${task.id}`)
        .send({ title: 'Renamed' })
        .expect(200);
      await as('admin').delete(`/api/v1/tasks/${task.id}`).expect(204);
    });

    it('allows any authenticated role to read tasks', async () => {
      const task = await seedTask();

      await as().get('/api/v1/tasks').expect(401);
      await as('user').get('/api/v1/tasks').expect(200);
      await as('user').get(`/api/v1/tasks/${task.id}`).expect(200);
      await as('admin').get('/api/v1/tasks').expect(200);
    });
  });

  describe('UsersController', () => {
    it('rejects unauthenticated requests to admin-only routes', async () => {
      const user = await seedUser();

      await as().get('/api/v1/users').expect(401);
      await as().get(`/api/v1/users/${user.id}`).expect(401);
      await as().patch(`/api/v1/users/${user.id}`).send({}).expect(401);
      await as().delete(`/api/v1/users/${user.id}`).expect(401);
    });

    it('rejects a non-admin user on admin-only routes', async () => {
      const user = await seedUser();

      await as('user').get('/api/v1/users').expect(403);
      await as('user').get(`/api/v1/users/${user.id}`).expect(403);
      await as('user')
        .patch(`/api/v1/users/${user.id}`)
        .send({ displayName: 'Someone Else' })
        .expect(403);
      await as('user').delete(`/api/v1/users/${user.id}`).expect(403);
    });

    it('allows an admin on admin-only routes', async () => {
      const user = await seedUser();

      await as('admin').get('/api/v1/users').expect(200);
      await as('admin').get(`/api/v1/users/${user.id}`).expect(200);
      await as('admin')
        .patch(`/api/v1/users/${user.id}`)
        .send({ displayName: 'Someone Else' })
        .expect(200);
      await as('admin').delete(`/api/v1/users/${user.id}`).expect(204);
    });

    it('lets any authenticated role read their own session via /me', async () => {
      await as().get('/api/v1/users/me').expect(401);
      await as('user').get('/api/v1/users/me').expect(200);
    });
  });
});
