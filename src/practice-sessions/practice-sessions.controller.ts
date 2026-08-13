import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PracticeSession, Recording } from '../generated/prisma/client';
import { CreatePracticeSessionDto } from './dto/create-practice-session.dto';
import { DeletePracticeSessionsQueryDto } from './dto/delete-practice-sessions-query.dto';
import { RecordingsService } from './recordings/recordings.service';
import { PracticeSessionsService } from './practice-sessions.service';

@Controller('practice-sessions')
export class PracticeSessionsController {
  constructor(
    private readonly practiceSessionsService: PracticeSessionsService,
    private readonly recordingsService: RecordingsService,
  ) {}

  @Post()
  create(
    @Session() session: UserSession,
    @Body() createPracticeSessionDto: CreatePracticeSessionDto,
  ): Promise<PracticeSession> {
    return this.practiceSessionsService.create(
      session.user.id,
      createPracticeSessionDto,
    );
  }

  @Get()
  findAll(@Session() session: UserSession): Promise<PracticeSession[]> {
    return this.practiceSessionsService.findAll(session.user.id);
  }

  // Bulk delete by exact title match, scoped to the caller's own sessions --
  // see the comment on PracticeSessionsService.deleteByTitle for why this is
  // safe despite having no other bulk/filtered delete precedent in the app.
  @Delete()
  async deleteByTitle(
    @Session() session: UserSession,
    @Query() query: DeletePracticeSessionsQueryDto,
  ): Promise<{ deletedCount: number }> {
    const deletedCount = await this.practiceSessionsService.deleteByTitle(
      session.user.id,
      query.title,
    );
    return { deletedCount };
  }

  @Get(':sessionId')
  findOne(
    @Session() session: UserSession,
    @Param('sessionId') sessionId: string,
  ): Promise<PracticeSession> {
    return this.practiceSessionsService.findById(session.user.id, sessionId);
  }

  @Post(':sessionId/recordings')
  @UseInterceptors(FileInterceptor('file'))
  async uploadRecording(
    @Session() session: UserSession,
    @Param('sessionId') sessionId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<Recording> {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }

    return this.recordingsService.upload(session.user.id, sessionId, file);
  }

  @Get(':sessionId/recordings')
  findRecordings(
    @Session() session: UserSession,
    @Param('sessionId') sessionId: string,
  ): Promise<Recording[]> {
    return this.recordingsService.findAllForSession(session.user.id, sessionId);
  }
}
