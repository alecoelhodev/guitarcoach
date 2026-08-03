import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  private readonly logger = new Logger(GcpStorageService.name);
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

  // Writes through a temp file + bucket.upload() (chunked, backpressure-paced
  // fs.createReadStream) rather than file.save(buffer)'s single .end(buffer)
  // call, which reliably triggered a "Cannot call write after a stream was
  // destroyed" race inside @google-cloud/storage's internal write pipeline
  // (see googleapis/nodejs-storage#312, #2367, #2560) when the whole buffer
  // was pushed before the async upload-request setup had settled.
  async uploadObject(
    objectName: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const tempDir = await mkdtemp(join(tmpdir(), 'gcs-upload-'));
    const tempFilePath = join(tempDir, 'upload');

    try {
      await writeFile(tempFilePath, buffer);
      await this.storage.bucket(this.bucketName).upload(tempFilePath, {
        destination: objectName,
        metadata: { contentType },
      });
    } catch (error) {
      this.logger.error(
        `Failed to upload object "${objectName}" (${buffer.length} bytes, ${contentType}) to bucket "${this.bucketName}"`,
        error,
      );
      throw error;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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
