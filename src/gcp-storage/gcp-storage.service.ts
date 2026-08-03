import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { EnvironmentVariables } from '../config/env.validation';

const GCS_NOT_FOUND_CODE = 404;

function isGcsNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === GCS_NOT_FOUND_CODE
  );
}

/**
 * Thin wrapper around @google-cloud/storage, scoped to a single configured
 * bucket. Path-agnostic by design: callers build the full object name
 * (e.g. users/{userId}/practice-sessions/{sessionId}/{uuid}-{fileName}),
 * this service just moves bytes in/out under that name.
 */
@Injectable()
export class GcpStorageService {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    this.storage = new Storage({
      projectId: configService.get('GCP_PROJECT_ID', { infer: true }),
    });
    this.bucketName = configService.get('GCS_RECORDINGS_BUCKET', {
      infer: true,
    });
  }

  async uploadObject(
    objectName: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.storage
      .bucket(this.bucketName)
      .file(objectName)
      .save(buffer, { contentType, resumable: false });
  }

  async getSignedDownloadUrl(
    objectName: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const [url] = await this.storage
      .bucket(this.bucketName)
      .file(objectName)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresInSeconds * 1000,
      });

    return url;
  }

  async deleteObject(objectName: string): Promise<void> {
    try {
      await this.storage.bucket(this.bucketName).file(objectName).delete();
    } catch (error) {
      if (isGcsNotFoundError(error)) return;
      throw error;
    }
  }
}
