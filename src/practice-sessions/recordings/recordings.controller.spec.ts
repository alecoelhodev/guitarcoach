import { Test, TestingModule } from '@nestjs/testing';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { RecordingsController } from './recordings.controller';
import { DownloadUrlResponse, RecordingsService } from './recordings.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const RECORDING_ID = 'a3f1c2d4-3333-4b2a-9c3d-000000000000';

function buildSession(): UserSession {
  return { user: { id: USER_ID } } as UserSession;
}

describe('RecordingsController', () => {
  let controller: RecordingsController;
  let service: {
    getDownloadUrl: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getDownloadUrl: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [{ provide: RecordingsService, useValue: service }],
    }).compile();

    controller = module.get<RecordingsController>(RecordingsController);
  });

  it('scopes getDownloadUrl() to the session user', async () => {
    const response: DownloadUrlResponse = {
      url: 'https://signed.example/take.mp3',
    };
    service.getDownloadUrl.mockResolvedValue(response);

    const result = await controller.getDownloadUrl(
      buildSession(),
      RECORDING_ID,
    );

    expect(service.getDownloadUrl).toHaveBeenCalledWith(USER_ID, RECORDING_ID);
    expect(result).toEqual(response);
  });

  it('scopes remove() to the session user', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove(buildSession(), RECORDING_ID);

    expect(service.remove).toHaveBeenCalledWith(USER_ID, RECORDING_ID);
  });
});
