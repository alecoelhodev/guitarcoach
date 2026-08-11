import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAiClient } from '../ai-practice-planner/openai/openai-responses.service';
import { OPENAI_CLIENT } from '../ai-practice-planner/openai/openai.constants';
import { PracticeSessionsModule } from '../practice-sessions/practice-sessions.module';
import { RoutinesModule } from '../routines/routines.module';
import { TasksModule } from '../tasks/tasks.module';
import { AGENT_RUNNER, DefaultAgentRunner } from './agent/agent-runner';
import { RoutineCoachAgentFactory } from './agent/routine-coach-agent.factory';
import { AiRoutineCoachController } from './ai-routine-coach.controller';
import { AiRoutineCoachService } from './ai-routine-coach.service';

@Module({
  imports: [RoutinesModule, TasksModule, PracticeSessionsModule],
  controllers: [AiRoutineCoachController],
  providers: [
    AiRoutineCoachService,
    RoutineCoachAgentFactory,
    {
      provide: OPENAI_CLIENT,
      inject: [ConfigService],
      useFactory: createOpenAiClient,
    },
    { provide: AGENT_RUNNER, useClass: DefaultAgentRunner },
  ],
})
export class AiRoutineCoachModule {}
