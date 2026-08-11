import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, setDefaultOpenAIClient } from '@openai/agents';
import OpenAI from 'openai';
import { EnvironmentVariables } from '../../config/env.validation';
import { OPENAI_CLIENT } from '../../ai-practice-planner/openai/openai.constants';
import { PracticeSessionsService } from '../../practice-sessions/practice-sessions.service';
import { RoutinesService } from '../../routines/routines.service';
import { TasksService } from '../../tasks/tasks.service';
import { buildCreateRoutineTool } from '../tools/create-routine.tool';
import { buildGetRecentPracticeSessionsTool } from '../tools/get-recent-practice-sessions.tool';
import { buildGetRecentRoutinesTool } from '../tools/get-recent-routines.tool';
import { buildGetTaskStatsTool } from '../tools/get-task-stats.tool';
import { buildGetUserTasksTool } from '../tools/get-user-tasks.tool';
import { RoutineCoachContext } from './routine-coach.context';
import { RoutineCoachInputGuardrail } from './routine-coach.guardrail';
import { ROUTINE_COACH_INSTRUCTIONS } from './routine-coach.instructions';

// Default (singleton) Nest scope is required: setDefaultOpenAIClient() is a
// process-wide setter in the @openai/agents SDK, so this must run exactly
// once per process, not per request.
@Injectable()
export class RoutineCoachAgentFactory {
  private readonly agent: Agent<RoutineCoachContext>;

  constructor(
    routinesService: RoutinesService,
    tasksService: TasksService,
    practiceSessionsService: PracticeSessionsService,
    @Inject(OPENAI_CLIENT) client: OpenAI,
    configService: ConfigService<EnvironmentVariables, true>,
  ) {
    setDefaultOpenAIClient(client);

    this.agent = new Agent<RoutineCoachContext>({
      name: 'RoutineCoachAgent',
      model: configService.get('OPENAI_MODEL', { infer: true }),
      instructions: ROUTINE_COACH_INSTRUCTIONS,
      tools: [
        buildGetRecentPracticeSessionsTool({ practiceSessionsService }),
        buildGetRecentRoutinesTool({ routinesService }),
        buildGetUserTasksTool({ tasksService }),
        buildGetTaskStatsTool({ practiceSessionsService }),
        buildCreateRoutineTool({ routinesService, tasksService }),
      ],
      inputGuardrails: [RoutineCoachInputGuardrail],
    });
  }

  getAgent(): Agent<RoutineCoachContext> {
    return this.agent;
  }
}
