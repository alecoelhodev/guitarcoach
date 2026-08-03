import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PracticeSession, Recording } from '../../generated/prisma/client';
import { GcpStorageService } from '../../gcp-storage/gcp-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PracticeSessionsService } from '../practice-sessions.service';
import { RecordingsService } from './recordings.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const SESSION_ID = 'a3f1c2d4-1111-4b2a-9c3d-000000000000';
const RECORDING_ID = 'a3f1c2d4-3333-4b2a-9c3d-000000000000';
const OBJECT_NAME = `users/${USER_ID}/practice-sessions/${SESSION_ID}/uuid-take.mp3`;
const DOWNLOAD_EXPIRY_SECONDS = 900;

function buildPracticeSession(
  overrides: Partial<PracticeSession> = {},
): PracticeSession {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    title: 'Morning warm-up',
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: RECORDING_ID,
    userId: USER_ID,
    practiceSessionId: SESSION_ID,
    objectName: OBJECT_NAME,
    originalFileName: 'take.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildFile(): Express.Multer.File {
  return {
    originalname: 'take.mp3',
    mimetype: 'audio/mpeg',
    size: 1024,
    buffer: Buffer.from('audio-bytes'),
  } as Express.Multer.File;
}

type MockPrismaService = {
  recording: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    delete: jest.Mock;
  };
};

type MockGcpStorageService = {
  uploadObject: jest.Mock<Promise<void>, [string, Buffer, string]>;
  getSignedDownloadUrl: jest.Mock<Promise<string>, [string, number]>;
  deleteObject: jest.Mock<Promise<void>, [string]>;
};

type MockPracticeSessionsService = {
  findById: jest.Mock;
};

describe('RecordingsService', () => {
  let service: RecordingsService;
  let prisma: MockPrismaService;
  let gcpStorage: MockGcpStorageService;
  let practiceSessionsService: MockPracticeSessionsService;

  beforeEach(async () => {
    prisma = {
      recording: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    };
    gcpStorage = {
      uploadObject: jest.fn<Promise<void>, [string, Buffer, string]>(),
      getSignedDownloadUrl: jest.fn<Promise<string>, [string, number]>(),
      deleteObject: jest.fn<Promise<void>, [string]>(),
    };
    practiceSessionsService = { findById: jest.fn() };
    practiceSessionsService.findById.mockResolvedValue(buildPracticeSession());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GcpStorageService, useValue: gcpStorage },
        {
          provide: PracticeSessionsService,
          useValue: practiceSessionsService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(DOWNLOAD_EXPIRY_SECONDS),
          },
        },
      ],
    }).compile();

    service = module.get<RecordingsService>(RecordingsService);
  });

  describe('upload', () => {
    it('verifies session ownership, uploads before creating the DB row, and returns it', async () => {
      const created = buildRecording();
      prisma.recording.create.mockResolvedValue(created);
      const file = buildFile();

      const result = await service.upload(USER_ID, SESSION_ID, file);

      expect(practiceSessionsService.findById).toHaveBeenCalledWith(
        USER_ID,
        SESSION_ID,
      );
      expect(gcpStorage.uploadObject).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(
            `^users/${USER_ID}/practice-sessions/${SESSION_ID}/[0-9a-f-]+-take\\.mp3$`,
          ),
        ),
        file.buffer,
        file.mimetype,
      );
      const uploadedObjectName = gcpStorage.uploadObject.mock.calls[0][0];
      expect(prisma.recording.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          practiceSessionId: SESSION_ID,
          objectName: uploadedObjectName,
          originalFileName: file.originalname,
          contentType: file.mimetype,
          sizeBytes: file.size,
        },
      });
      // uploadObject must be called before recording.create — an orphaned
      // GCS object is recoverable, an orphaned DB row pointing at nothing
      // that was never uploaded is not.
      expect(gcpStorage.uploadObject.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.recording.create.mock.invocationCallOrder[0],
      );
      expect(result).toEqual(created);
    });

    it('throws NotFoundException without uploading when the session is not owned by the user', async () => {
      practiceSessionsService.findById.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        service.upload(USER_ID, SESSION_ID, buildFile()),
      ).rejects.toThrow(NotFoundException);
      expect(gcpStorage.uploadObject).not.toHaveBeenCalled();
    });

    it('compensates by deleting the uploaded object and rethrows when the DB insert fails', async () => {
      const dbError = new Error('insert failed');
      prisma.recording.create.mockRejectedValue(dbError);

      await expect(
        service.upload(USER_ID, SESSION_ID, buildFile()),
      ).rejects.toThrow(dbError);

      expect(gcpStorage.deleteObject).toHaveBeenCalledWith(
        gcpStorage.uploadObject.mock.calls[0][0],
      );
    });

    it('still rethrows the original DB error when the compensating delete also fails', async () => {
      const dbError = new Error('insert failed');
      prisma.recording.create.mockRejectedValue(dbError);
      gcpStorage.deleteObject.mockRejectedValue(new Error('cleanup failed'));

      await expect(
        service.upload(USER_ID, SESSION_ID, buildFile()),
      ).rejects.toThrow(dbError);
    });
  });

  describe('findAllForSession', () => {
    it('verifies session ownership and lists recordings for it', async () => {
      const recordings = [buildRecording()];
      prisma.recording.findMany.mockResolvedValue(recordings);

      const result = await service.findAllForSession(USER_ID, SESSION_ID);

      expect(practiceSessionsService.findById).toHaveBeenCalledWith(
        USER_ID,
        SESSION_ID,
      );
      expect(prisma.recording.findMany).toHaveBeenCalledWith({
        where: { practiceSessionId: SESSION_ID },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(recordings);
    });

    it('throws NotFoundException when the session is not owned by the user', async () => {
      practiceSessionsService.findById.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        service.findAllForSession(USER_ID, SESSION_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recording.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl', () => {
    it('returns a signed URL for a recording owned by the user', async () => {
      const recording = buildRecording();
      prisma.recording.findFirst.mockResolvedValue(recording);
      gcpStorage.getSignedDownloadUrl.mockResolvedValue(
        'https://signed.example/take.mp3',
      );

      const result = await service.getDownloadUrl(USER_ID, RECORDING_ID);

      expect(prisma.recording.findFirst).toHaveBeenCalledWith({
        where: { id: RECORDING_ID, userId: USER_ID },
      });
      expect(gcpStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
        recording.objectName,
        DOWNLOAD_EXPIRY_SECONDS,
      );
      expect(result).toEqual({ url: 'https://signed.example/take.mp3' });
    });

    it('throws NotFoundException when no recording matches for the user', async () => {
      prisma.recording.findFirst.mockResolvedValue(null);

      await expect(
        service.getDownloadUrl(USER_ID, RECORDING_ID),
      ).rejects.toThrow(NotFoundException);
      expect(gcpStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the GCS object before the DB row', async () => {
      const recording = buildRecording();
      prisma.recording.findFirst.mockResolvedValue(recording);

      await service.remove(USER_ID, RECORDING_ID);

      expect(gcpStorage.deleteObject).toHaveBeenCalledWith(
        recording.objectName,
      );
      expect(prisma.recording.delete).toHaveBeenCalledWith({
        where: { id: recording.id },
      });
      expect(gcpStorage.deleteObject.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.recording.delete.mock.invocationCallOrder[0],
      );
    });

    it('throws NotFoundException without touching storage when not owned by the user', async () => {
      prisma.recording.findFirst.mockResolvedValue(null);

      await expect(service.remove(USER_ID, RECORDING_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(gcpStorage.deleteObject).not.toHaveBeenCalled();
      expect(prisma.recording.delete).not.toHaveBeenCalled();
    });

    it('does not delete the DB row when the GCS delete fails', async () => {
      const recording = buildRecording();
      prisma.recording.findFirst.mockResolvedValue(recording);
      gcpStorage.deleteObject.mockRejectedValue(new Error('GCS outage'));

      await expect(service.remove(USER_ID, RECORDING_ID)).rejects.toThrow(
        'GCS outage',
      );
      expect(prisma.recording.delete).not.toHaveBeenCalled();
    });
  });
});
