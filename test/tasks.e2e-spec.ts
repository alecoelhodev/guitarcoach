import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { buildTestApp } from './support/build-test-app';
import { requestAs } from './support/request-as';

interface TaskResponseBody {
  id: string;
  title: string;
  category: string | null;
  difficulty: string | null;
  referenceLink: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedTasksResponseBody {
  data: TaskResponseBody[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

describe('TasksController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    app = await buildTestApp();

    prisma = app.get(PrismaService);
    await prisma.routineTask.deleteMany();
    await prisma.task.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  // create/update/remove are admin-only per @Roles(['admin']) on
  // TasksController; RBAC enforcement itself is covered by
  // test/rbac.e2e-spec.ts, so these requests always authenticate as admin
  // to exercise CRUD behavior. Reads only require authentication, but admin
  // works there too.
  const admin = () => requestAs(app, 'admin');

  const createTask = (
    body: Record<string, unknown> = {
      title: 'Chromatic warm-up',
      category: 'technique',
      difficulty: 'easy',
    },
  ) => admin().post('/api/v1/tasks').send(body);

  describe('POST /api/v1/tasks', () => {
    it('creates a task', async () => {
      const response = await createTask().expect(201);

      const body = response.body as TaskResponseBody;
      expect(body).toMatchObject({
        title: 'Chromatic warm-up',
        category: 'technique',
        difficulty: 'easy',
      });
      expect(body.id).toEqual(expect.any(String));
    });

    it('rejects a title shorter than 2 characters', async () => {
      await createTask({ title: 'A' }).expect(400);
    });

    it('rejects unknown properties', async () => {
      await createTask({
        title: 'Chromatic warm-up',
        isFeatured: true,
      }).expect(400);
    });

    it('rejects an invalid reference link', async () => {
      await createTask({
        title: 'Chromatic warm-up',
        referenceLink: 'not-a-url',
      }).expect(400);
    });

    it('rejects an invalid category', async () => {
      await createTask({ title: 'Chromatic warm-up', category: 'jazz' }).expect(
        400,
      );
    });

    it('rejects an invalid difficulty', async () => {
      await createTask({
        title: 'Chromatic warm-up',
        difficulty: 'expert',
      }).expect(400);
    });
  });

  describe('GET /api/v1/tasks', () => {
    it('returns a paginated list of tasks', async () => {
      await createTask({
        title: 'Task A',
        category: 'technique',
        difficulty: 'easy',
      }).expect(201);
      await createTask({
        title: 'Task B',
        category: 'theory',
        difficulty: 'hard',
      }).expect(201);

      const response = await admin().get('/api/v1/tasks').expect(200);

      const body = response.body as PaginatedTasksResponseBody;
      expect(body.data).toHaveLength(2);
      expect(body.meta).toMatchObject({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('filters by category', async () => {
      await createTask({
        title: 'Task A',
        category: 'technique',
        difficulty: 'easy',
      }).expect(201);
      await createTask({
        title: 'Task B',
        category: 'theory',
        difficulty: 'hard',
      }).expect(201);

      const response = await admin()
        .get('/api/v1/tasks?category=theory')
        .expect(200);

      const body = response.body as PaginatedTasksResponseBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ category: 'theory' });
    });

    it('filters by difficulty', async () => {
      await createTask({
        title: 'Task A',
        category: 'technique',
        difficulty: 'easy',
      }).expect(201);
      await createTask({
        title: 'Task B',
        category: 'theory',
        difficulty: 'hard',
      }).expect(201);

      const response = await admin()
        .get('/api/v1/tasks?difficulty=hard')
        .expect(200);

      const body = response.body as PaginatedTasksResponseBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ difficulty: 'hard' });
    });

    it('paginates results', async () => {
      for (let i = 0; i < 3; i += 1) {
        await createTask({
          title: `Task ${i}`,
          category: 'technique',
          difficulty: 'easy',
        }).expect(201);
      }

      const response = await admin()
        .get('/api/v1/tasks?page=1&limit=2')
        .expect(200);

      const body = response.body as PaginatedTasksResponseBody;
      expect(body.data).toHaveLength(2);
      expect(body.meta).toMatchObject({
        total: 3,
        page: 1,
        limit: 2,
        totalPages: 2,
      });
    });
  });

  describe('GET /api/v1/tasks/:id', () => {
    it('returns the task when found', async () => {
      const created = await createTask().expect(201);
      const createdBody = created.body as TaskResponseBody;

      const response = await admin()
        .get(`/api/v1/tasks/${createdBody.id}`)
        .expect(200);

      expect((response.body as TaskResponseBody).id).toBe(createdBody.id);
    });

    it('returns 404 when the task does not exist', async () => {
      await admin()
        .get('/api/v1/tasks/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/tasks/:id', () => {
    it('updates the task', async () => {
      const created = await createTask().expect(201);
      const createdBody = created.body as TaskResponseBody;

      const response = await admin()
        .patch(`/api/v1/tasks/${createdBody.id}`)
        .send({ difficulty: 'medium' })
        .expect(200);

      expect((response.body as TaskResponseBody).difficulty).toBe('medium');
    });

    it('returns 404 when the task does not exist', async () => {
      await admin()
        .patch('/api/v1/tasks/00000000-0000-0000-0000-000000000000')
        .send({ difficulty: 'medium' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/tasks/:id', () => {
    it('deletes the task and returns 204', async () => {
      const created = await createTask().expect(201);
      const createdBody = created.body as TaskResponseBody;

      await admin().delete(`/api/v1/tasks/${createdBody.id}`).expect(204);

      await admin().get(`/api/v1/tasks/${createdBody.id}`).expect(404);
    });

    it('returns 404 when the task does not exist', async () => {
      await admin()
        .delete('/api/v1/tasks/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
