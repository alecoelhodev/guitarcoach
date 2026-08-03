import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { DownloadUrlResponse, RecordingsService } from './recordings.service';

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  @Get(':recordingId/download-url')
  getDownloadUrl(
    @Session() session: UserSession,
    @Param('recordingId') recordingId: string,
  ): Promise<DownloadUrlResponse> {
    return this.recordingsService.getDownloadUrl(session.user.id, recordingId);
  }

  @Delete(':recordingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Session() session: UserSession,
    @Param('recordingId') recordingId: string,
  ): Promise<void> {
    return this.recordingsService.remove(session.user.id, recordingId);
  }
}
