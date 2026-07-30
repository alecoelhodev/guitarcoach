import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { buildTestApp } from './support/build-test-app';
import { requestAs } from './support/request-as';

interface RoutineResponseBody {
  id: string;
  userId: string;
  title: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedRoutinesResponseBody {
  data: RoutineResponseBody[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

describe('RoutinesController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    app = await buildTestApp();

    prisma = app.get(PrismaService);
    await prisma.routineTask.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.task.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  // Routines are owned by the authenticated user (Routine.userId is a
  // required FK to User), so unlike tasks/users each e2e user here must be a
  // real seeded Prisma User row, and requests authenticate as that row's id.
  const seedUser = (overrides: { email?: string; displayName?: string } = {}) =>
    prisma.user.create({
      data: {
        email: overrides.email ?? 'jordan@example.com',
        displayName: overrides.displayName ?? 'Jordan',
      },
    });

  const asUser = (userId: string) => requestAs(app, 'user', userId);

  const createRoutine = (
    userId: string,
    body: Record<string, unknown> = { title: 'Daily warm-up' },
  ) => asUser(userId).post('/api/v1/routines').send(body);

  describe('POST /api/v1/routines', () => {
    it('creates a routine owned by the authenticated user', async () => {
      const user = await seedUser();

      const response = await createRoutine(user.id).expect(201);

      const body = response.body as RoutineResponseBody;
      expect(body).toMatchObject({ title: 'Daily warm-up', status: 'active' });
      expect(body.userId).toBe(user.id);
      expect(body.id).toEqual(expect.any(String));
    });

    it('rejects an unauthenticated request', async () => {
      await requestAs(app)
        .post('/api/v1/routines')
        .send({ title: 'Daily warm-up' })
        .expect(401);
    });

    it('rejects a title shorter than 2 characters', async () => {
      const user = await seedUser();

      await createRoutine(user.id, { title: 'A' }).expect(400);
    });

    it('rejects unknown properties', async () => {
      const user = await seedUser();

      await createRoutine(user.id, {
        title: 'Daily warm-up',
        isFeatured: true,
      }).expect(400);
    });

    it('rejects an invalid status', async () => {
      const user = await seedUser();

      await createRoutine(user.id, {
        title: 'Daily warm-up',
        status: 'paused',
      }).expect(400);
    });

    it('rejects a client-supplied userId (derived from the session instead)', async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });

      // userId isn't part of CreateRoutineDto, so the global whitelist pipe
      // rejects it with 400 — proving it can't be smuggled into the body to
      // create a routine owned by someone else.
      await createRoutine(owner.id, {
        title: 'Daily warm-up',
        userId: other.id,
      }).expect(400);
    });
  });

  describe('GET /api/v1/routines', () => {
    it('returns only the authenticated user routines, paginated', async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      await createRoutine(owner.id, { title: 'Routine A' }).expect(201);
      await createRoutine(owner.id, { title: 'Routine B' }).expect(201);
      await createRoutine(other.id, { title: "Other's routine" }).expect(201);

      const response = await asUser(owner.id)
        .get('/api/v1/routines')
        .expect(200);

      const body = response.body as PaginatedRoutinesResponseBody;
      expect(body.data).toHaveLength(2);
      expect(body.data.every((routine) => routine.userId === owner.id)).toBe(
        true,
      );
      expect(body.meta).toMatchObject({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('filters by status', async () => {
      const user = await seedUser();
      const active = await createRoutine(user.id, {
        title: 'Active routine',
      }).expect(201);
      const toArchive = await createRoutine(user.id, {
        title: 'Archived routine',
      }).expect(201);
      const toArchiveBody = toArchive.body as RoutineResponseBody;
      await asUser(user.id)
        .patch(`/api/v1/routines/${toArchiveBody.id}`)
        .send({ status: 'archived' })
        .expect(200);

      const response = await asUser(user.id)
        .get('/api/v1/routines?status=archived')
        .expect(200);

      const body = response.body as PaginatedRoutinesResponseBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe('archived');
      expect(body.data[0].id).not.toBe((active.body as RoutineResponseBody).id);
    });

    it('paginates results', async () => {
      const user = await seedUser();
      for (let i = 0; i < 3; i += 1) {
        await createRoutine(user.id, { title: `Routine ${i}` }).expect(201);
      }

      const response = await asUser(user.id)
        .get('/api/v1/routines?page=1&limit=2')
        .expect(200);

      const body = response.body as PaginatedRoutinesResponseBody;
      expect(body.data).toHaveLength(2);
      expect(body.meta).toMatchObject({
        total: 3,
        page: 1,
        limit: 2,
        totalPages: 2,
      });
    });

    it('rejects an unauthenticated request', async () => {
      await requestAs(app).get('/api/v1/routines').expect(401);
    });
  });

  describe('GET /api/v1/routines/:id', () => {
    it('returns the routine when owned by the requester', async () => {
      const user = await seedUser();
      const created = await createRoutine(user.id).expect(201);
      const createdBody = created.body as RoutineResponseBody;

      const response = await asUser(user.id)
        .get(`/api/v1/routines/${createdBody.id}`)
        .expect(200);

      expect((response.body as RoutineResponseBody).id).toBe(createdBody.id);
    });

    it('returns 404 when the routine does not exist', async () => {
      const user = await seedUser();

      await asUser(user.id)
        .get('/api/v1/routines/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it("returns 404 for another user's routine", async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const created = await createRoutine(owner.id).expect(201);
      const createdBody = created.body as RoutineResponseBody;

      await asUser(other.id)
        .get(`/api/v1/routines/${createdBody.id}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/routines/:id', () => {
    it('updates a routine owned by the requester', async () => {
      const user = await seedUser();
      const created = await createRoutine(user.id).expect(201);
      const createdBody = created.body as RoutineResponseBody;

      const response = await asUser(user.id)
        .patch(`/api/v1/routines/${createdBody.id}`)
        .send({ status: 'archived' })
        .expect(200);

      expect((response.body as RoutineResponseBody).status).toBe('archived');
    });

    it('returns 404 when the routine does not exist', async () => {
      const user = await seedUser();

      await asUser(user.id)
        .patch('/api/v1/routines/00000000-0000-0000-0000-000000000000')
        .send({ status: 'archived' })
        .expect(404);
    });

    it("returns 404 when patching another user's routine", async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const created = await createRoutine(owner.id).expect(201);
      const createdBody = created.body as RoutineResponseBody;

      await asUser(other.id)
        .patch(`/api/v1/routines/${createdBody.id}`)
        .send({ status: 'archived' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/routines/:id', () => {
    it('deletes the routine and returns 204', async () => {
      const user = await seedUser();
      const created = await createRoutine(user.id).expect(201);
      const createdBody = created.body as RoutineResponseBody;

      await asUser(user.id)
        .delete(`/api/v1/routines/${createdBody.id}`)
        .expect(204);

      await asUser(user.id)
        .get(`/api/v1/routines/${createdBody.id}`)
        .expect(404);
    });

    it('returns 404 when the routine does not exist', async () => {
      const user = await seedUser();

      await asUser(user.id)
        .delete('/api/v1/routines/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it("returns 404 when deleting another user's routine", async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const created = await createRoutine(owner.id).expect(201);
      const createdBody = created.body as RoutineResponseBody;

      await asUser(other.id)
        .delete(`/api/v1/routines/${createdBody.id}`)
        .expect(404);
    });

    it('returns 409 when the routine still has tasks assigned', async () => {
      const user = await seedUser();
      const created = await createRoutine(user.id).expect(201);
      const createdBody = created.body as RoutineResponseBody;
      const task = await prisma.task.create({
        data: { title: 'Chromatic warm-up' },
      });
      await prisma.routineTask.create({
        data: { routineId: createdBody.id, taskId: task.id, position: 1 },
      });

      await asUser(user.id)
        .delete(`/api/v1/routines/${createdBody.id}`)
        .expect(409);
    });
  });
});
