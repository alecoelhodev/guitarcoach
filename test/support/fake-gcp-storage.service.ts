import { Injectable } from '@nestjs/common';

/**
 * In-memory stand-in for GcpStorageService, swapped in via overrideProvider
 * in buildTestApp so e2e specs never make real GCS calls. Exposes the same
 * three methods, plus `objects` so specs can assert what was actually
 * uploaded/deleted.
 */
@Injectable()
export class FakeGcpStorageService {
  readonly objects = new Map<string, Buffer>();

  uploadObject(objectName: string, buffer: Buffer): Promise<void> {
    this.objects.set(objectName, buffer);
    return Promise.resolve();
  }

  getSignedDownloadUrl(
    objectName: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return Promise.resolve(
      `https://fake-gcs.example/${objectName}?expires=${expiresInSeconds}`,
    );
  }

  deleteObject(objectName: string): Promise<void> {
    this.objects.delete(objectName);
    return Promise.resolve();
  }
}
