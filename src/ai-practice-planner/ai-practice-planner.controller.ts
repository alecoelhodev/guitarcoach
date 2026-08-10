import { Body, Controller, Post } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import {
  AiPracticePlannerService,
  PracticePlannerResponse,
} from './ai-practice-planner.service';
import { PracticePlannerRequestDto } from './dto/practice-planner-request.dto';

@Controller('ai/practice-planner')
export class AiPracticePlannerController {
  constructor(private readonly service: AiPracticePlannerService) {}

  @Post()
  handle(
    @Session() session: UserSession,
    @Body() dto: PracticePlannerRequestDto,
  ): Promise<PracticePlannerResponse> {
    return this.service.handleRequest(session.user.id, dto);
  }
}
