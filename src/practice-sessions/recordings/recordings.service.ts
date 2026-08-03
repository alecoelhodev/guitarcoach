import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { EnvironmentVariables } from '../../config/env.validation';
import { Recording } from '../../generated/prisma/client';
import { GcpStorageService } from '../../gcp-storage/gcp-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PracticeSessionsService } from '../practice-sessions.service';

export interface DownloadUrlResponse {
  url: string;
}

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Recording with id "${id}" not found`);
}

// Only the trailing filename segment is client-controlled; the prefix
// (users/{userId}/practice-sessions/{sessionId}/{uuid}-) is always
// server-derived, so this can't be used to escape that prefix. Stripped as
// hygiene for clean, predictable object names, not as a traversal fix.
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[/\\]/g, '_').replace(/^\.+/, '');
}

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcpStorage: GcpStorageService,
    private readonly practiceSessionsService: PracticeSessionsService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async upload(
    userId: string,
    practiceSessionId: string,
    file: Express.Multer.File,
  ): Promise<Recording> {
    await this.practiceSessionsService.findById(userId, practiceSessionId);

    const objectName = `users/${userId}/practice-sessions/${practiceSessionId}/${randomUUID()}-${sanitizeFileName(file.originalname)}`;

    await this.gcpStorage.uploadObject(objectName, file.buffer, file.mimetype);

    try {
      return await this.prisma.recording.create({
        data: {
          userId,
          practiceSessionId,
          objectName,
          originalFileName: file.originalname,
          contentType: file.mimetype,
          sizeBytes: file.size,
        },
      });
    } catch (error) {
      try {
        await this.gcpStorage.deleteObject(objectName);
      } catch (cleanupError) {
        this.logger.error(
          `Failed to clean up orphaned GCS object "${objectName}" after a failed recording insert`,
          cleanupError,
        );
      }
      throw error;
    }
  }

  async findAllForSession(
    userId: string,
    practiceSessionId: string,
  ): Promise<Recording[]> {
    await this.practiceSessionsService.findById(userId, practiceSessionId);

    return this.prisma.recording.findMany({
      where: { practiceSessionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDownloadUrl(
    userId: string,
    id: string,
  ): Promise<DownloadUrlResponse> {
    const recording = await this.findOwnedRecording(userId, id);
    const expiresInSeconds = this.configService.get(
      'RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS',
      { infer: true },
    );

    const url = await this.gcpStorage.getSignedDownloadUrl(
      recording.objectName,
      expiresInSeconds,
    );

    return { url };
  }

  async remove(userId: string, id: string): Promise<void> {
    const recording = await this.findOwnedRecording(userId, id);

    await this.gcpStorage.deleteObject(recording.objectName);
    await this.prisma.recording.delete({ where: { id: recording.id } });
  }

  private async findOwnedRecording(
    userId: string,
    id: string,
  ): Promise<Recording> {
    const recording = await this.prisma.recording.findFirst({
      where: { id, userId },
    });

    if (!recording) {
      throw notFound(id);
    }

    return recording;
  }
}
