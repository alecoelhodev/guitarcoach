import { INestApplication } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { App } from 'supertest/types';
import { ACTIVITY_FEED_CLIENT } from '../src/activity-feed/activity-feed.constants';
import { buildTestApp } from './support/build-test-app';
import { requestAs } from './support/request-as';

describe('ActivityFeedController (e2e)', () => {
  let app: INestApplication<App>;
  let client: { send: jest.Mock };

  beforeEach(async () => {
    app = await buildTestApp();
    client = app.get<ClientProxy>(ACTIVITY_FEED_CLIENT) as unknown as {
      send: jest.Mock;
    };
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/activity-feed', () => {
    it('returns the feed entries from the ActivityFeedService client', async () => {
      const userId = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
      const canned = [
        { routineId: 'routine-1', title: 'Daily warm-up', status: 'active' },
      ];
      client.send.mockReturnValue(of(canned));

      const response = await requestAs(app, 'user', userId)
        .get('/api/v1/activity-feed')
        .expect(200);

      expect(response.body).toEqual(canned);
    });

    it('derives userId from the authenticated session, ignoring a client-supplied userId query param', async () => {
      const sessionUserId = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
      client.send.mockReturnValue(of([]));

      await requestAs(app, 'user', sessionUserId)
        .get('/api/v1/activity-feed?userId=someone-elses-id')
        .expect(200);

      expect(client.send).toHaveBeenCalledWith(expect.any(String), {
        userId: sessionUserId,
      });
    });

    it('rejects an unauthenticated request', async () => {
      await requestAs(app).get('/api/v1/activity-feed').expect(401);
    });
  });
});
