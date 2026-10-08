import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AI_PROVIDER } from './../src/ai-practice-planner/openai/openai.constants';
import { PrismaService } from './../src/prisma/prisma.service';
import { buildTestApp } from './support/build-test-app';
import { FakeAiProvider } from './support/fake-ai-provider';
import { requestAs } from './support/request-as';

interface DraftsBody {
  drafts: {
    title: string;
    category: string;
    difficulty: string;
  }[];
}

describe('AI task generator and bulk create (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeAiProvider: FakeAiProvider;

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
    fakeAiProvider = app.get<FakeAiProvider>(AI_PROVIDER);
  });

  afterEach(async () => {
    await app.close();
  });

  // A real user row per test: the AI rate limit counts per user id, in real Redis.
  const seedUser = async (email: string) =>
    (await prisma.user.create({ data: { email, displayName: 'Test' } })).id;
  const as = (role: 'admin' | 'user', userId: string) =>
    requestAs(app, role, userId);

  describe('POST /api/v1/ai/task-generator', () => {
    it('drafts the requested number of tasks and saves nothing', async () => {
      const admin = await seedUser('admin@example.com');
      await prisma.task.create({ data: { title: 'Alternate picking' } });
      await prisma.task.create({
        data: { title: 'Private one', ownerId: admin },
      });

      const response = await as('admin', admin)
        .post('/api/v1/ai/task-generator')
        .send({ prompt: 'Famous 7-string riffs', count: 3 })
        .expect(200);

      const body = response.body as DraftsBody;
      expect(body.drafts).toHaveLength(3);
      expect(body.drafts[0]).toMatchObject({
        category: 'repertoire',
        difficulty: 'medium',
      });
      // Every link the model produced on a device was broken, so drafts carry none.
      expect(body.drafts[0]).not.toHaveProperty('referenceLink');
      // Only shared titles steer the model; nothing new was written.
      expect(fakeAiProvider.lastExistingTitles).toEqual(['Alternate picking']);
      await expect(prisma.task.count()).resolves.toBe(2);
    });

    it('is admin-only', async () => {
      const user = await seedUser('user@example.com');

      await as('user', user)
        .post('/api/v1/ai/task-generator')
        .send({ prompt: 'Riffs', count: 3 })
        .expect(403);
    });

    it.each([0, 11, 2.5])('rejects a count of %p', async (count) => {
      const admin = await seedUser('admin@example.com');

      await as('admin', admin)
        .post('/api/v1/ai/task-generator')
        .send({ prompt: 'Riffs', count })
        .expect(400);
    });
  });

  describe('POST /api/v1/tasks/bulk', () => {
    it('creates every task, shared and listed', async () => {
      const admin = await seedUser('admin@example.com');

      const response = await as('admin', admin)
        .post('/api/v1/tasks/bulk')
        .send({
          tasks: [
            { title: 'Riff A', category: 'repertoire', difficulty: 'hard' },
            { title: 'Riff B', referenceLink: 'https://example.com/b' },
          ],
        })
        .expect(201);

      expect(response.body).toHaveLength(2);
      const list = await as('admin', admin).get('/api/v1/tasks').expect(200);
      expect((list.body as { data: unknown[] }).data).toHaveLength(2);
    });

    it('creates nothing when any task is invalid', async () => {
      const admin = await seedUser('admin@example.com');

      await as('admin', admin)
        .post('/api/v1/tasks/bulk')
        .send({ tasks: [{ title: 'Riff A' }, { title: 'x' }] })
        .expect(400);

      await expect(prisma.task.count()).resolves.toBe(0);
    });

    it.each([
      ['no tasks', []],
      [
        'more than ten',
        Array.from({ length: 11 }, (_, i) => ({ title: `T ${i}` })),
      ],
    ])('rejects %s', async (_label, tasks) => {
      const admin = await seedUser('admin@example.com');

      await as('admin', admin)
        .post('/api/v1/tasks/bulk')
        .send({ tasks })
        .expect(400);
    });

    it('is admin-only', async () => {
      const user = await seedUser('user@example.com');

      await as('user', user)
        .post('/api/v1/tasks/bulk')
        .send({ tasks: [{ title: 'Riff A' }] })
        .expect(403);
    });
  });
});
