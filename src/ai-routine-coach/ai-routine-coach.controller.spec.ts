import { Test, TestingModule } from '@nestjs/testing';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AiRoutineCoachController } from './ai-routine-coach.controller';
import { AiRoutineCoachService } from './ai-routine-coach.service';
import { RoutineCoachRequestDto } from './dto/routine-coach-request.dto';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';

function buildSession(): UserSession {
  return { user: { id: USER_ID } } as UserSession;
}

describe('AiRoutineCoachController', () => {
  let controller: AiRoutineCoachController;
  let service: { handleRequest: jest.Mock };

  beforeEach(async () => {
    service = { handleRequest: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiRoutineCoachController],
      providers: [{ provide: AiRoutineCoachService, useValue: service }],
    }).compile();

    controller = module.get<AiRoutineCoachController>(AiRoutineCoachController);
  });

  // The controller must derive userId from the session, never from the
  // request body -- otherwise a caller could supply an arbitrary userId.
  // This pins that contract at the controller layer.
  it('forwards only the session user id and the message to the service', async () => {
    const dto: RoutineCoachRequestDto = {
      message: 'Create a 30-minute routine.',
    };
    service.handleRequest.mockResolvedValue({ message: 'Done.' });

    const result = await controller.handle(buildSession(), dto);

    expect(service.handleRequest).toHaveBeenCalledWith(
      USER_ID,
      'Create a 30-minute routine.',
    );
    expect(result).toEqual({ message: 'Done.' });
  });
});
