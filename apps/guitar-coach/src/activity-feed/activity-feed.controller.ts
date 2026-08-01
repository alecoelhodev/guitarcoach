import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { firstValueFrom } from 'rxjs';
import {
  ACTIVITY_FEED_CLIENT,
  ACTIVITY_FEED_GET_BY_USER_PATTERN,
} from './activity-feed.constants';

@Controller('activity-feed')
export class ActivityFeedController {
  constructor(
    @Inject(ACTIVITY_FEED_CLIENT) private readonly client: ClientProxy,
  ) {}

  // userId deliberately comes only from the authenticated session — no
  // @Query() parameter is accepted, so a client-supplied ?userId=... is
  // inert and can't be used to read another user's feed.
  @Get()
  getFeed(@Session() session: UserSession) {
    return firstValueFrom(
      this.client.send(ACTIVITY_FEED_GET_BY_USER_PATTERN, {
        userId: session.user.id,
      }),
    );
  }
}
