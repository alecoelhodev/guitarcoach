import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { GcpStorageService } from '../src/gcp-storage/gcp-storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildTestApp } from './support/build-test-app';
import { FakeGcpStorageService } from './support/fake-gcp-storage.service';
import { requestAs } from './support/request-as';

interface PracticeSessionResponseBody {
  id: string;
  userId: string;
  title: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RecordingResponseBody {
  id: string;
  userId: string;
  practiceSessionId: string;
  objectName: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

describe('PracticeSessionsController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gcpStorage: FakeGcpStorageService;

  beforeEach(async () => {
    app = await buildTestApp();

    prisma = app.get(PrismaService);
    gcpStorage = app.get(GcpStorageService);
    await prisma.recording.deleteMany();
    await prisma.practiceSession.deleteMany();
    await prisma.routineTask.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.task.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  const seedUser = (overrides: { email?: string; displayName?: string } = {}) =>
    prisma.user.create({
      data: {
        email: overrides.email ?? 'jordan@example.com',
        displayName: overrides.displayName ?? 'Jordan',
      },
    });

  const asUser = (userId: string) => requestAs(app, 'user', userId);

  const createPracticeSession = (
    userId: string,
    body: Record<string, unknown> = { title: 'Morning warm-up' },
  ) => asUser(userId).post('/api/v1/practice-sessions').send(body);

  const AUDIO_BUFFER = Buffer.from('fake-audio-bytes');

  describe('POST /api/v1/practice-sessions', () => {
    it('creates a practice session owned by the authenticated user', async () => {
      const user = await seedUser();

      const response = await createPracticeSession(user.id).expect(201);

      const body = response.body as PracticeSessionResponseBody;
      expect(body).toMatchObject({ title: 'Morning warm-up' });
      expect(body.userId).toBe(user.id);
      expect(body.id).toEqual(expect.any(String));
    });

    it('rejects an unauthenticated request', async () => {
      await requestAs(app)
        .post('/api/v1/practice-sessions')
        .send({ title: 'Morning warm-up' })
        .expect(401);
    });

    it('rejects a client-supplied userId (derived from the session instead)', async () => {
      const owner = await seedUser({ email: 'owner@example.com' });

      await createPracticeSession(owner.id, {
        title: 'Morning warm-up',
        userId: 'someone-else',
      }).expect(400);
    });
  });

  describe('GET /api/v1/practice-sessions', () => {
    it('returns only the authenticated user practice sessions', async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      await createPracticeSession(owner.id, { title: 'Session A' }).expect(201);
      await createPracticeSession(other.id, {
        title: "Other's session",
      }).expect(201);

      const response = await asUser(owner.id)
        .get('/api/v1/practice-sessions')
        .expect(200);

      const body = response.body as PracticeSessionResponseBody[];
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Session A');
    });

    it('rejects an unauthenticated request', async () => {
      await requestAs(app).get('/api/v1/practice-sessions').expect(401);
    });
  });

  describe('GET /api/v1/practice-sessions/:sessionId', () => {
    it('returns the session when owned by the requester', async () => {
      const user = await seedUser();
      const created = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;

      const response = await asUser(user.id)
        .get(`/api/v1/practice-sessions/${created.id}`)
        .expect(200);

      expect((response.body as PracticeSessionResponseBody).id).toBe(
        created.id,
      );
    });

    it('returns 404 when the session does not exist', async () => {
      const user = await seedUser();

      await asUser(user.id)
        .get('/api/v1/practice-sessions/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it("returns 404 for another user's session", async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const created = (await createPracticeSession(owner.id).expect(201))
        .body as PracticeSessionResponseBody;

      await asUser(other.id)
        .get(`/api/v1/practice-sessions/${created.id}`)
        .expect(404);
    });
  });

  describe('POST /api/v1/practice-sessions/:sessionId/recordings', () => {
    it('uploads a valid audio file and persists its metadata', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;

      const response = await asUser(user.id)
        .post(`/api/v1/practice-sessions/${session.id}/recordings`)
        .attach('file', AUDIO_BUFFER, {
          filename: 'take.mp3',
          contentType: 'audio/mpeg',
        })
        .expect(201);

      const body = response.body as RecordingResponseBody;
      expect(body).toMatchObject({
        userId: user.id,
        practiceSessionId: session.id,
        originalFileName: 'take.mp3',
        contentType: 'audio/mpeg',
        sizeBytes: AUDIO_BUFFER.length,
      });
      expect(body.objectName).toBe(
        `users/${user.id}/practice-sessions/${session.id}/${body.objectName.split('/').pop()}`,
      );
      expect(gcpStorage.objects.has(body.objectName)).toBe(true);
    });

    it('rejects an unsupported file type', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;

      await asUser(user.id)
        .post(`/api/v1/practice-sessions/${session.id}/recordings`)
        .attach('file', Buffer.from('not-audio'), {
          filename: 'take.png',
          contentType: 'image/png',
        })
        .expect(400);
    });

    it('rejects a file exceeding the configured max size', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;
      // RECORDING_UPLOAD_MAX_SIZE_BYTES defaults to 50MB; comfortably exceed
      // it without actually allocating tens of megabytes in the test.
      const oversized = Buffer.alloc(51 * 1024 * 1024);

      // Nest's FileInterceptor maps multer's LIMIT_FILE_SIZE error to
      // PayloadTooLargeException (413) internally, before any application
      // exception filter would see it.
      await asUser(user.id)
        .post(`/api/v1/practice-sessions/${session.id}/recordings`)
        .attach('file', oversized, {
          filename: 'take.wav',
          contentType: 'audio/wav',
        })
        .expect(413);
    });

    it("returns 404 when uploading to another user's session", async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const session = (await createPracticeSession(owner.id).expect(201))
        .body as PracticeSessionResponseBody;

      await asUser(other.id)
        .post(`/api/v1/practice-sessions/${session.id}/recordings`)
        .attach('file', AUDIO_BUFFER, {
          filename: 'take.mp3',
          contentType: 'audio/mpeg',
        })
        .expect(404);
    });

    it('returns 404 when the session does not exist', async () => {
      const user = await seedUser();

      await asUser(user.id)
        .post(
          '/api/v1/practice-sessions/00000000-0000-0000-0000-000000000000/recordings',
        )
        .attach('file', AUDIO_BUFFER, {
          filename: 'take.mp3',
          contentType: 'audio/mpeg',
        })
        .expect(404);
    });

    it('rejects an unauthenticated request', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;

      await requestAs(app)
        .post(`/api/v1/practice-sessions/${session.id}/recordings`)
        .attach('file', AUDIO_BUFFER, {
          filename: 'take.mp3',
          contentType: 'audio/mpeg',
        })
        .expect(401);
    });
  });

  describe('GET /api/v1/practice-sessions/:sessionId/recordings', () => {
    it('lists recordings scoped to the session', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;
      await asUser(user.id)
        .post(`/api/v1/practice-sessions/${session.id}/recordings`)
        .attach('file', AUDIO_BUFFER, {
          filename: 'take.mp3',
          contentType: 'audio/mpeg',
        })
        .expect(201);

      const response = await asUser(user.id)
        .get(`/api/v1/practice-sessions/${session.id}/recordings`)
        .expect(200);

      const body = response.body as RecordingResponseBody[];
      expect(body).toHaveLength(1);
      expect(body[0].practiceSessionId).toBe(session.id);
    });

    it("returns 404 for another user's session", async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const session = (await createPracticeSession(owner.id).expect(201))
        .body as PracticeSessionResponseBody;

      await asUser(other.id)
        .get(`/api/v1/practice-sessions/${session.id}/recordings`)
        .expect(404);
    });
  });

  describe('GET /api/v1/recordings/:recordingId/download-url', () => {
    it('returns a signed URL for a recording owned by the requester', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;
      const recording = (
        await asUser(user.id)
          .post(`/api/v1/practice-sessions/${session.id}/recordings`)
          .attach('file', AUDIO_BUFFER, {
            filename: 'take.mp3',
            contentType: 'audio/mpeg',
          })
          .expect(201)
      ).body as RecordingResponseBody;

      const response = await asUser(user.id)
        .get(`/api/v1/recordings/${recording.id}/download-url`)
        .expect(200);

      expect((response.body as { url: string }).url).toContain(
        recording.objectName,
      );
    });

    it('returns 404 when the recording does not exist', async () => {
      const user = await seedUser();

      await asUser(user.id)
        .get(
          '/api/v1/recordings/00000000-0000-0000-0000-000000000000/download-url',
        )
        .expect(404);
    });

    it("returns 404 for another user's recording", async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const session = (await createPracticeSession(owner.id).expect(201))
        .body as PracticeSessionResponseBody;
      const recording = (
        await asUser(owner.id)
          .post(`/api/v1/practice-sessions/${session.id}/recordings`)
          .attach('file', AUDIO_BUFFER, {
            filename: 'take.mp3',
            contentType: 'audio/mpeg',
          })
          .expect(201)
      ).body as RecordingResponseBody;

      await asUser(other.id)
        .get(`/api/v1/recordings/${recording.id}/download-url`)
        .expect(404);
    });

    it('rejects an unauthenticated request', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;
      const recording = (
        await asUser(user.id)
          .post(`/api/v1/practice-sessions/${session.id}/recordings`)
          .attach('file', AUDIO_BUFFER, {
            filename: 'take.mp3',
            contentType: 'audio/mpeg',
          })
          .expect(201)
      ).body as RecordingResponseBody;

      await requestAs(app)
        .get(`/api/v1/recordings/${recording.id}/download-url`)
        .expect(401);
    });
  });

  describe('DELETE /api/v1/recordings/:recordingId', () => {
    it('deletes the recording and its storage object, returning 204', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;
      const recording = (
        await asUser(user.id)
          .post(`/api/v1/practice-sessions/${session.id}/recordings`)
          .attach('file', AUDIO_BUFFER, {
            filename: 'take.mp3',
            contentType: 'audio/mpeg',
          })
          .expect(201)
      ).body as RecordingResponseBody;
      expect(gcpStorage.objects.has(recording.objectName)).toBe(true);

      await asUser(user.id)
        .delete(`/api/v1/recordings/${recording.id}`)
        .expect(204);

      expect(gcpStorage.objects.has(recording.objectName)).toBe(false);
      await asUser(user.id)
        .get(`/api/v1/recordings/${recording.id}/download-url`)
        .expect(404);
    });

    it('returns 404 when the recording does not exist', async () => {
      const user = await seedUser();

      await asUser(user.id)
        .delete('/api/v1/recordings/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it("returns 404 for another user's recording and leaves it intact", async () => {
      const owner = await seedUser({ email: 'owner@example.com' });
      const other = await seedUser({
        email: 'other@example.com',
        displayName: 'Other',
      });
      const session = (await createPracticeSession(owner.id).expect(201))
        .body as PracticeSessionResponseBody;
      const recording = (
        await asUser(owner.id)
          .post(`/api/v1/practice-sessions/${session.id}/recordings`)
          .attach('file', AUDIO_BUFFER, {
            filename: 'take.mp3',
            contentType: 'audio/mpeg',
          })
          .expect(201)
      ).body as RecordingResponseBody;

      await asUser(other.id)
        .delete(`/api/v1/recordings/${recording.id}`)
        .expect(404);

      expect(gcpStorage.objects.has(recording.objectName)).toBe(true);
      await asUser(owner.id)
        .get(`/api/v1/recordings/${recording.id}/download-url`)
        .expect(200);
    });

    it('rejects an unauthenticated request', async () => {
      const user = await seedUser();
      const session = (await createPracticeSession(user.id).expect(201))
        .body as PracticeSessionResponseBody;
      const recording = (
        await asUser(user.id)
          .post(`/api/v1/practice-sessions/${session.id}/recordings`)
          .attach('file', AUDIO_BUFFER, {
            filename: 'take.mp3',
            contentType: 'audio/mpeg',
          })
          .expect(201)
      ).body as RecordingResponseBody;

      await requestAs(app)
        .delete(`/api/v1/recordings/${recording.id}`)
        .expect(401);
    });
  });
});
