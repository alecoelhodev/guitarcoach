import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PracticeSession, Recording } from '../generated/prisma/client';
import { PracticeSessionsController } from './practice-sessions.controller';
import { PracticeSessionsService } from './practice-sessions.service';
import { RecordingsService } from './recordings/recordings.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const SESSION_ID = 'a3f1c2d4-1111-4b2a-9c3d-000000000000';
const RECORDING_ID = 'a3f1c2d4-3333-4b2a-9c3d-000000000000';

function buildSession(): UserSession {
  return { user: { id: USER_ID } } as UserSession;
}

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
    objectName: `users/${USER_ID}/practice-sessions/${SESSION_ID}/uuid-take.mp3`,
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

describe('PracticeSessionsController', () => {
  let controller: PracticeSessionsController;
  let practiceSessionsService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
  };
  let recordingsService: {
    upload: jest.Mock;
    findAllForSession: jest.Mock;
  };

  beforeEach(async () => {
    practiceSessionsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
    };
    recordingsService = {
      upload: jest.fn(),
      findAllForSession: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeSessionsController],
      providers: [
        {
          provide: PracticeSessionsService,
          useValue: practiceSessionsService,
        },
        { provide: RecordingsService, useValue: recordingsService },
      ],
    }).compile();

    controller = module.get<PracticeSessionsController>(
      PracticeSessionsController,
    );
  });

  // The controller derives userId from the session, never from the request
  // body/params — pinning that contract, same as RoutinesController's specs.

  it('scopes create() to the session user', async () => {
    const created = buildPracticeSession();
    practiceSessionsService.create.mockResolvedValue(created);

    const result = await controller.create(buildSession(), {
      title: 'Morning warm-up',
    });

    expect(practiceSessionsService.create).toHaveBeenCalledWith(USER_ID, {
      title: 'Morning warm-up',
    });
    expect(result).toEqual(created);
  });

  it('scopes findAll() to the session user', async () => {
    const sessions = [buildPracticeSession()];
    practiceSessionsService.findAll.mockResolvedValue(sessions);

    const result = await controller.findAll(buildSession());

    expect(practiceSessionsService.findAll).toHaveBeenCalledWith(USER_ID);
    expect(result).toEqual(sessions);
  });

  it('scopes findOne() to the session user', async () => {
    const session = buildPracticeSession();
    practiceSessionsService.findById.mockResolvedValue(session);

    const result = await controller.findOne(buildSession(), SESSION_ID);

    expect(practiceSessionsService.findById).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
    );
    expect(result).toEqual(session);
  });

  it('delegates uploadRecording() to RecordingsService with the session user', async () => {
    const recording = buildRecording();
    const file = buildFile();
    recordingsService.upload.mockResolvedValue(recording);

    const result = await controller.uploadRecording(
      buildSession(),
      SESSION_ID,
      file,
    );

    expect(recordingsService.upload).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      file,
    );
    expect(result).toEqual(recording);
  });

  it('throws BadRequestException when uploadRecording() receives no file', async () => {
    await expect(
      controller.uploadRecording(buildSession(), SESSION_ID, undefined),
    ).rejects.toThrow(BadRequestException);
    expect(recordingsService.upload).not.toHaveBeenCalled();
  });

  it('delegates findRecordings() to RecordingsService with the session user', async () => {
    const recordings = [buildRecording()];
    recordingsService.findAllForSession.mockResolvedValue(recordings);

    const result = await controller.findRecordings(buildSession(), SESSION_ID);

    expect(recordingsService.findAllForSession).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
    );
    expect(result).toEqual(recordings);
  });
});
