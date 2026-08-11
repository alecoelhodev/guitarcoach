import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoutinesModule } from '../routines/routines.module';
import { TasksModule } from '../tasks/tasks.module';
import { AiPracticePlannerController } from './ai-practice-planner.controller';
import { AiPracticePlannerService } from './ai-practice-planner.service';
import {
  createOpenAiClient,
  OpenAiResponsesService,
} from './openai/openai-responses.service';
import { AI_PROVIDER, OPENAI_CLIENT } from './openai/openai.constants';
import { CreateRoutineTool } from './tools/create-routine.tool';

@Module({
  imports: [RoutinesModule, TasksModule],
  controllers: [AiPracticePlannerController],
  providers: [
    AiPracticePlannerService,
    CreateRoutineTool,
    {
      provide: OPENAI_CLIENT,
      inject: [ConfigService],
      useFactory: createOpenAiClient,
    },
    { provide: AI_PROVIDER, useClass: OpenAiResponsesService },
  ],
})
export class AiPracticePlannerModule {}
