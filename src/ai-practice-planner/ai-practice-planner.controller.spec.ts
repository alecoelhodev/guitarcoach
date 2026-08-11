import { Test, TestingModule } from '@nestjs/testing';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AiPracticePlannerController } from './ai-practice-planner.controller';
import {
  AiPracticePlannerService,
  PracticePlannerResponse,
} from './ai-practice-planner.service';
import { PracticePlannerRequestDto } from './dto/practice-planner-request.dto';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';

function buildSession(): UserSession {
  return { user: { id: USER_ID } } as UserSession;
}

describe('AiPracticePlannerController', () => {
  let controller: AiPracticePlannerController;
  let service: { handleRequest: jest.Mock };

  beforeEach(async () => {
    service = { handleRequest: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiPracticePlannerController],
      providers: [{ provide: AiPracticePlannerService, useValue: service }],
    }).compile();

    controller = module.get<AiPracticePlannerController>(
      AiPracticePlannerController,
    );
  });

  // The controller derives userId from the session, never from the request
  // body -- otherwise the AI/caller could supply an arbitrary userId. This
  // pins that contract at the controller layer.

  it('scopes handle() to the session user and passes the dto through unchanged', async () => {
    const dto: PracticePlannerRequestDto = { prompt: 'A blues routine' };
    const response: PracticePlannerResponse = {
      status: 'awaiting_confirmation',
      plan: {
        title: 'Blues',
        summary: 'summary',
        totalDurationMinutes: 30,
        tasks: [{ title: 'Warm-up', description: 'desc', durationMinutes: 30 }],
        requiresConfirmation: true,
      },
      previousResponseId: 'resp_1',
    };
    service.handleRequest.mockResolvedValue(response);

    const result = await controller.handle(buildSession(), dto);

    expect(service.handleRequest).toHaveBeenCalledWith(USER_ID, dto);
    expect(result).toEqual(response);
  });

  it('scopes a confirmation request to the session user', async () => {
    const dto: PracticePlannerRequestDto = {
      confirmation: true,
      previousResponseId: 'resp_1',
    };
    const response: PracticePlannerResponse = {
      status: 'created',
      routine: { routineId: 'r1', title: 'Blues', taskCount: 1 },
    };
    service.handleRequest.mockResolvedValue(response);

    const result = await controller.handle(buildSession(), dto);

    expect(service.handleRequest).toHaveBeenCalledWith(USER_ID, dto);
    expect(result).toEqual(response);
  });

  it('scopes a decline request to the session user', async () => {
    const dto: PracticePlannerRequestDto = {
      confirmation: false,
      previousResponseId: 'resp_1',
    };
    const response: PracticePlannerResponse = { status: 'cancelled' };
    service.handleRequest.mockResolvedValue(response);

    const result = await controller.handle(buildSession(), dto);

    expect(service.handleRequest).toHaveBeenCalledWith(USER_ID, dto);
    expect(result).toEqual(response);
  });
});
