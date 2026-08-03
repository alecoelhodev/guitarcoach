import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { GcpStorageService } from './gcp-storage.service';

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(),
}));

jest.mock('node:fs/promises', () => ({
  mkdtemp: jest.fn(),
  writeFile: jest.fn(),
  rm: jest.fn(),
}));

const TEMP_DIR = '/tmp/gcs-upload-test';

type MockBucket = {
  file: jest.Mock;
  upload: jest.Mock;
};

describe('GcpStorageService', () => {
  let service: GcpStorageService;
  let bucket: MockBucket;

  beforeEach(() => {
    (mkdtemp as jest.Mock).mockResolvedValue(TEMP_DIR);
    (writeFile as jest.Mock).mockResolvedValue(undefined);
    (rm as jest.Mock).mockResolvedValue(undefined);

    bucket = {
      file: jest.fn().mockReturnValue({
        getSignedUrl: jest
          .fn()
          .mockResolvedValue(['https://signed.example/url']),
        delete: jest.fn().mockResolvedValue(undefined),
      }),
      upload: jest.fn().mockResolvedValue(undefined),
    };
    (Storage as unknown as jest.Mock).mockReturnValue({
      bucket: jest.fn().mockReturnValue(bucket),
    });

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'GCP_PROJECT_ID') return 'test-project';
        if (key === 'GCS_RECORDINGS_BUCKET') return 'test-bucket';
        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as unknown as ConfigService;

    service = new GcpStorageService(configService);
  });

  describe('uploadObject', () => {
    it('writes the buffer to a temp file, uploads it, then cleans up', async () => {
      const buffer = Buffer.from('audio-bytes');

      await service.uploadObject('object-name', buffer, 'audio/mpeg');

      const tempFilePath = `${TEMP_DIR}/upload`;
      expect(writeFile).toHaveBeenCalledWith(tempFilePath, buffer);
      // bucket.upload() (chunked via fs.createReadStream) is used instead of
      // file.save(buffer) (a single .end(buffer) call) — the latter reliably
      // triggered a "stream was destroyed" race in the client library's
      // internal write pipeline. Asserting this shape guards against
      // regressing back to file.save().
      expect(bucket.upload).toHaveBeenCalledWith(tempFilePath, {
        destination: 'object-name',
        metadata: { contentType: 'audio/mpeg' },
      });
      expect(rm).toHaveBeenCalledWith(TEMP_DIR, {
        recursive: true,
        force: true,
      });
    });

    it('logs context, rethrows, and still cleans up when the upload fails', async () => {
      const error = new Error('upload failed');
      bucket.upload.mockRejectedValue(error);
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.uploadObject('object-name', Buffer.from('x'), 'audio/mpeg'),
      ).rejects.toBe(error);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('object-name'),
        error,
      );
      expect(rm).toHaveBeenCalledWith(TEMP_DIR, {
        recursive: true,
        force: true,
      });
    });
  });
});
