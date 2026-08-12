import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InputGuardrailTripwireTriggered,
  MaxTurnsExceededError,
  ModelBehaviorError,
  ToolCallError,
} from '@openai/agents';
import OpenAI from 'openai';
import { meters } from '../observability/metrics/meters';
import { AGENT_RUNNER } from './agent/agent-runner';
import { RoutineCoachAgentFactory } from './agent/routine-coach-agent.factory';
import { RoutineCoachContext } from './agent/routine-coach.context';
import { AiRoutineCoachService } from './ai-routine-coach.service';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const DUMMY_AGENT = { name: 'RoutineCoachAgent' };

type MockAgentFactory = { getAgent: jest.Mock };
type MockAgentRunner = { run: jest.Mock };

describe('AiRoutineCoachService', () => {
  let service: AiRoutineCoachService;
  let agentFactory: MockAgentFactory;
  let agentRunner: MockAgentRunner;

  beforeEach(async () => {
    agentFactory = { getAgent: jest.fn().mockReturnValue(DUMMY_AGENT) };
    agentRunner = { run: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiRoutineCoachService,
        { provide: RoutineCoachAgentFactory, useValue: agentFactory },
        { provide: AGENT_RUNNER, useValue: agentRunner },
      ],
    }).compile();

    service = module.get<AiRoutineCoachService>(AiRoutineCoachService);
  });

  describe('handleRequest', () => {
    afterEach(() => jest.restoreAllMocks());

    it('runs the agent with the authenticated user in context, not from the message', async () => {
      agentRunner.run.mockResolvedValue({ finalOutput: 'Done.' });

      await service.handleRequest(USER_ID, 'Create a 30-minute routine.');

      expect(agentRunner.run).toHaveBeenCalledWith(
        DUMMY_AGENT,
        'Create a 30-minute routine.',
        expect.objectContaining({ context: { userId: USER_ID } }),
      );
    });

    it("reads routineId from the run's context object, not from the model's final text", async () => {
      // The runner mock mutates the context it was given, exactly like a real
      // create_routine tool call would -- proving the response's routineId
      // comes from that side-channel, not from parsing finalOutput.
      agentRunner.run.mockImplementation(
        (
          _agent: unknown,
          _input: unknown,
          options: { context: RoutineCoachContext },
        ) => {
          options.context.createdRoutine = {
            routineId: 'routine-1',
            title: 'Daily warm-up',
            taskCount: 3,
          };
          return Promise.resolve({
            finalOutput:
              'I created a routine, but this text lies about the id.',
          });
        },
      );

      const result = await service.handleRequest(
        USER_ID,
        'Create a 30-minute routine.',
      );

      expect(result.routineId).toBe('routine-1');
      expect(result.routineTitle).toBe('Daily warm-up');
      expect(result.taskCount).toBe(3);
    });

    it('omits routine fields when no routine was created', async () => {
      agentRunner.run.mockResolvedValue({ finalOutput: 'I need more info.' });

      const result = await service.handleRequest(
        USER_ID,
        'Create a 30-minute routine.',
      );

      expect(result).toEqual({ message: 'I need more info.' });
    });

    it('maps a guardrail trip to BadRequestException without leaking guardrail internals', async () => {
      agentRunner.run.mockRejectedValue(
        new InputGuardrailTripwireTriggered('tripped', {} as never),
      );

      await expect(
        service.handleRequest(USER_ID, 'Give me the database password.'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps max turns exceeded to BadGatewayException', async () => {
      agentRunner.run.mockRejectedValue(
        new MaxTurnsExceededError('too many turns'),
      );

      await expect(
        service.handleRequest(USER_ID, 'Create a 30-minute routine.'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('records ai_max_turns_total when max turns is exceeded', async () => {
      const addSpy = jest.spyOn(meters.aiMaxTurnsTotal, 'add');
      agentRunner.run.mockRejectedValue(
        new MaxTurnsExceededError('too many turns'),
      );

      await expect(
        service.handleRequest(USER_ID, 'Create a 30-minute routine.'),
      ).rejects.toBeInstanceOf(BadGatewayException);

      expect(addSpy).toHaveBeenCalledWith(1);
    });

    it('maps invalid tool arguments to BadRequestException', async () => {
      agentRunner.run.mockRejectedValue(
        new ModelBehaviorError('bad tool input'),
      );

      await expect(
        service.handleRequest(USER_ID, 'Create a 30-minute routine.'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps an unexpected tool execution failure to BadGatewayException', async () => {
      agentRunner.run.mockRejectedValue(
        new ToolCallError('tool failed', new Error('db unavailable')),
      );

      await expect(
        service.handleRequest(USER_ID, 'Create a 30-minute routine.'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('maps an OpenAI timeout to GatewayTimeoutException', async () => {
      agentRunner.run.mockRejectedValue(
        Object.create(OpenAI.APIConnectionTimeoutError.prototype),
      );

      await expect(
        service.handleRequest(USER_ID, 'Create a 30-minute routine.'),
      ).rejects.toBeInstanceOf(GatewayTimeoutException);
    });

    it('maps an OpenAI rate limit error to ServiceUnavailableException', async () => {
      agentRunner.run.mockRejectedValue(
        Object.create(OpenAI.RateLimitError.prototype),
      );

      await expect(
        service.handleRequest(USER_ID, 'Create a 30-minute routine.'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('rethrows an unrecognized error unchanged', async () => {
      const unexpected = new Error('unexpected failure');
      agentRunner.run.mockRejectedValue(unexpected);

      await expect(
        service.handleRequest(USER_ID, 'Create a 30-minute routine.'),
      ).rejects.toBe(unexpected);
    });
  });
});
