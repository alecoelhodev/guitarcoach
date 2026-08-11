import { Body, Controller, Post } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AiRoutineCoachService } from './ai-routine-coach.service';
import { RoutineCoachRequestDto } from './dto/routine-coach-request.dto';
import { RoutineCoachResponse } from './dto/routine-coach-response';

@Controller('ai/routine-coach')
export class AiRoutineCoachController {
  constructor(private readonly service: AiRoutineCoachService) {}

  @Post()
  handle(
    @Session() session: UserSession,
    @Body() dto: RoutineCoachRequestDto,
  ): Promise<RoutineCoachResponse> {
    return this.service.handleRequest(session.user.id, dto.message);
  }
}
