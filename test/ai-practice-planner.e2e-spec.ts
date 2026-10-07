import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AI_PROVIDER } from '../src/ai-practice-planner/openai/openai.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildTestApp } from './support/build-test-app';
import { FakeAiProvider } from './support/fake-ai-provider';
import { requestAs } from './support/request-as';

interface AwaitingConfirmationBody {
  status: 'awaiting_confirmation';
  plan: {
    title: string;
    tasks: { title: string; description: string; durationMinutes: number }[];
  };
  previousResponseId: string;
}

interface CreatedBody {
  status: 'created';
  routine: { routineId: string; title: string; taskCount: number };
}

interface CancelledBody {
  status: 'cancelled';
}

describe('AiPracticePlannerController (e2e)', () => {
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

  // Routines are owned by the authenticated user (Routine.userId is a
  // required FK to User), so each e2e user here must be a real seeded Prisma
  // User row, matching routines.e2e-spec.ts's convention.
  const seedUser = (overrides: { email?: string; displayName?: string } = {}) =>
    prisma.user.create({
      data: {
        email: overrides.email ?? 'jordan@example.com',
        displayName: overrides.displayName ?? 'Jordan',
      },
    });

  const asUser = (userId: string) => requestAs(app, 'user', userId);

  const requestPlan = (userId: string, body: Record<string, unknown>) =>
    asUser(userId).post('/api/v1/ai/practice-planner').send(body);

  describe('POST /api/v1/ai/practice-planner', () => {
    it('returns a structured plan awaiting confirmation without persisting anything', async () => {
      const user = await seedUser();

      const response = await requestPlan(user.id, {
        prompt:
          'Create me a 30-minute blues routine focused on bending and improvisation.',
      }).expect(201);

      const body = response.body as AwaitingConfirmationBody;
      expect(body.status).toBe('awaiting_confirmation');
      expect(body.plan.title).toEqual(expect.any(String));
      expect(body.plan.tasks.length).toBeGreaterThan(0);
      expect(body.previousResponseId).toEqual(expect.any(String));

      await expect(prisma.routine.count()).resolves.toBe(0);
      await expect(prisma.task.count()).resolves.toBe(0);
    });

    it('persists the routine and its tasks once the plan is confirmed', async () => {
      const user = await seedUser();

      const planResponse = await requestPlan(user.id, {
        prompt:
          'Create me a 30-minute blues routine focused on bending and improvisation.',
      }).expect(201);
      const { previousResponseId, plan } =
        planResponse.body as AwaitingConfirmationBody;

      const confirmResponse = await requestPlan(user.id, {
        confirmation: true,
        previousResponseId,
      }).expect(201);

      const body = confirmResponse.body as CreatedBody;
      expect(body.status).toBe('created');
      expect(body.routine.taskCount).toBe(plan.tasks.length);

      const routines = await prisma.routine.findMany({
        where: { userId: user.id },
      });
      expect(routines).toHaveLength(1);
      expect(routines[0].id).toBe(body.routine.routineId);
      expect(routines[0].title).toBe(body.routine.title);

      const routineTasks = await prisma.routineTask.findMany({
        where: { routineId: body.routine.routineId },
        orderBy: { position: 'asc' },
      });
      expect(routineTasks).toHaveLength(plan.tasks.length);
      expect(routineTasks.map((rt) => rt.position)).toEqual(
        plan.tasks.map((_, index) => index + 1),
      );
      expect(routineTasks.map((rt) => rt.targetDurationMinutes)).toEqual(
        plan.tasks.map((task) => task.durationMinutes),
      );

      await expect(prisma.task.count()).resolves.toBe(plan.tasks.length);
    });

    it("keeps the plan's tasks private to its user, out of the shared library", async () => {
      const user = await seedUser();
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const planResponse = await requestPlan(user.id, {
        prompt: 'Create me a 30 minute warm-up routine.',
      }).expect(201);
      const { previousResponseId } =
        planResponse.body as AwaitingConfirmationBody;
      await requestPlan(user.id, {
        confirmation: true,
        previousResponseId,
      }).expect(201);

      const created = await prisma.task.findMany();
      expect(created.length).toBeGreaterThan(0);
      expect(created.every((task) => task.ownerId === user.id)).toBe(true);
      const privateId = created[0].id;

      // Not listed in the library for anyone, owner included.
      const list = await asUser(user.id).get('/api/v1/tasks').expect(200);
      expect((list.body as { data: unknown[] }).data).toHaveLength(0);

      // Readable by the owner (their routine links to it), missing for others.
      await asUser(user.id).get(`/api/v1/tasks/${privateId}`).expect(200);
      await asUser(other.id).get(`/api/v1/tasks/${privateId}`).expect(404);

      // Another user cannot pull it into their own routine or log it.
      const theirs = await prisma.routine.create({
        data: { userId: other.id, title: 'Mine' },
      });
      await asUser(other.id)
        .post(`/api/v1/routines/${theirs.id}/tasks`)
        .send({ taskId: privateId })
        .expect(404);
      await asUser(other.id)
        .post('/api/v1/practice-sessions')
        .send({ tasks: [{ taskId: privateId }] })
        .expect(404);

      // Deleting the owner's account takes the private tasks with it.
      await asUser(user.id).delete('/api/v1/users/me').expect(204);
      await expect(prisma.task.count()).resolves.toBe(0);
    });

    it('persists nothing when the user declines the plan', async () => {
      const user = await seedUser();

      const planResponse = await requestPlan(user.id, {
        prompt: 'Create me a 30-minute blues routine.',
      }).expect(201);
      const { previousResponseId } =
        planResponse.body as AwaitingConfirmationBody;

      const response = await requestPlan(user.id, {
        confirmation: false,
        previousResponseId,
      }).expect(201);

      expect((response.body as CancelledBody).status).toBe('cancelled');
      await expect(prisma.routine.count()).resolves.toBe(0);
    });

    it('rejects confirmation of a plan owned by a different user', async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const attacker = await seedUser({ email: 'attacker@example.com' });

      const planResponse = await requestPlan(owner.id, {
        prompt: 'Create me a 30-minute blues routine.',
      }).expect(201);
      const { previousResponseId } =
        planResponse.body as AwaitingConfirmationBody;

      await requestPlan(attacker.id, {
        confirmation: true,
        previousResponseId,
      }).expect(404);

      await expect(prisma.routine.count()).resolves.toBe(0);
    });

    it('rejects a request with neither prompt nor confirmation', async () => {
      const user = await seedUser();

      await requestPlan(user.id, {}).expect(400);
    });

    it('rejects a request with both prompt and confirmation', async () => {
      const user = await seedUser();

      await requestPlan(user.id, {
        prompt: 'Create me a routine.',
        confirmation: true,
        previousResponseId: 'resp_whatever',
      }).expect(400);
    });

    it('caps each user at 30 AI requests an hour, with Retry-After', async () => {
      const user = await seedUser();
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });

      for (let i = 0; i < 30; i += 1) {
        await requestPlan(user.id, { prompt: 'A 30 minute warm-up.' }).expect(
          201,
        );
      }
      const limited = await requestPlan(user.id, {
        prompt: 'A 30 minute warm-up.',
      }).expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      // The window is per user.
      await requestPlan(other.id, { prompt: 'A 30 minute warm-up.' }).expect(
        201,
      );
    });

    it('rejects an unauthenticated request', async () => {
      await requestAs(app)
        .post('/api/v1/ai/practice-planner')
        .send({ prompt: 'Create me a routine.' })
        .expect(401);
    });

    it('surfaces an OpenAI failure as a mapped error without affecting other endpoints', async () => {
      const user = await seedUser();
      fakeAiProvider.generatePracticePlan = (): ReturnType<
        FakeAiProvider['generatePracticePlan']
      > => Promise.reject(new Error('simulated OpenAI outage'));

      await requestPlan(user.id, {
        prompt: 'Create me a routine.',
      }).expect(500);

      // Unrelated endpoint keeps working — the AI failure is scoped to this
      // controller, not a global crash.
      await asUser(user.id).get('/api/v1/routines').expect(200);
    });
  });
});
