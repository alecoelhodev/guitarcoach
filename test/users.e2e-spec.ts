import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  const createUser = (
    body: Record<string, unknown> = {
      email: 'jordan@example.com',
      displayName: 'Jordan',
    },
  ) => request(app.getHttpServer()).post('/api/v1/users').send(body);

  describe('POST /api/v1/users', () => {
    it('creates a user', async () => {
      const response = await createUser().expect(201);

      const body = response.body as UserResponseBody;
      expect(body).toMatchObject({
        email: 'jordan@example.com',
        displayName: 'Jordan',
      });
      expect(body.id).toEqual(expect.any(String));
    });

    it('rejects an invalid email', async () => {
      await createUser({ email: 'not-an-email', displayName: 'Jordan' }).expect(
        400,
      );
    });

    it('rejects a display name shorter than 2 characters', async () => {
      await createUser({
        email: 'jordan@example.com',
        displayName: 'A',
      }).expect(400);
    });

    it('rejects unknown properties', async () => {
      await createUser({
        email: 'jordan@example.com',
        displayName: 'Jordan',
        isAdmin: true,
      }).expect(400);
    });

    it('rejects a duplicate email with 409', async () => {
      await createUser().expect(201);

      await createUser({
        email: 'JORDAN@example.com',
        displayName: 'Someone Else',
      }).expect(409);
    });
  });

  describe('GET /api/v1/users', () => {
    it('returns an array of users', async () => {
      await createUser().expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/v1/users')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('returns the user when found', async () => {
      const created = await createUser().expect(201);
      const createdBody = created.body as UserResponseBody;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${createdBody.id}`)
        .expect(200);

      expect((response.body as UserResponseBody).id).toBe(createdBody.id);
    });

    it('returns 404 when the user does not exist', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/users/:id', () => {
    it('updates the user', async () => {
      const created = await createUser().expect(201);
      const createdBody = created.body as UserResponseBody;

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/users/${createdBody.id}`)
        .send({ displayName: 'Jordan Casey' })
        .expect(200);

      expect((response.body as UserResponseBody).displayName).toBe(
        'Jordan Casey',
      );
    });

    it('returns 409 when updating to another user email', async () => {
      await createUser({ email: 'a@example.com', displayName: 'AA' }).expect(
        201,
      );
      const userB = await createUser({
        email: 'b@example.com',
        displayName: 'BB',
      }).expect(201);
      const userBBody = userB.body as UserResponseBody;

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${userBBody.id}`)
        .send({ email: 'a@example.com' })
        .expect(409);
    });

    it('returns 404 when the user does not exist', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .send({ displayName: 'Jordan Casey' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/users/:id', () => {
    it('deletes the user and returns 204', async () => {
      const created = await createUser().expect(201);
      const createdBody = created.body as UserResponseBody;

      await request(app.getHttpServer())
        .delete(`/api/v1/users/${createdBody.id}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/users/${createdBody.id}`)
        .expect(404);
    });

    it('returns 404 when the user does not exist', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
