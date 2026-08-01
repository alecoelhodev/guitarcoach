import { ClientProxy } from '@nestjs/microservices';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { of } from 'rxjs';
import { ActivityFeedController } from './activity-feed.controller';
import { ACTIVITY_FEED_GET_BY_USER_PATTERN } from './activity-feed.constants';

const SESSION = {
  user: { id: 'a3f1c2d4-2222-4b2a-9c3d-000000000000' },
} as UserSession;

describe('ActivityFeedController', () => {
  let controller: ActivityFeedController;
  let client: { send: jest.Mock };

  beforeEach(() => {
    client = { send: jest.fn() };
    controller = new ActivityFeedController(client as unknown as ClientProxy);
  });

  it('requests the feed for the authenticated session user and returns the resolved value', async () => {
    const canned = [{ id: 'activity-1' }];
    client.send.mockReturnValue(of(canned));

    const result: unknown = await controller.getFeed(SESSION);

    expect(client.send).toHaveBeenCalledWith(
      ACTIVITY_FEED_GET_BY_USER_PATTERN,
      { userId: SESSION.user.id },
    );
    expect(result).toEqual(canned);
  });
});
