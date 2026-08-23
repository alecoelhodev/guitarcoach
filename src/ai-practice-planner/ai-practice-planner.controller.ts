import { Body, Controller, Post } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import {
  AiPracticePlannerService,
  PracticePlannerResponse,
} from './ai-practice-planner.service';
import { PracticePlannerRequestDto } from './dto/practice-planner-request.dto';
import {
  AwaitingConfirmationResponseDto,
  PlanCancelledResponseDto,
  PlanCreatedResponseDto,
} from './dto/practice-planner-response.dto';

@Controller('ai/practice-planner')
@ApiExtraModels(
  AwaitingConfirmationResponseDto,
  PlanCreatedResponseDto,
  PlanCancelledResponseDto,
)
export class AiPracticePlannerController {
  constructor(private readonly service: AiPracticePlannerService) {}

  @Post()
  @ApiResponse({
    status: 200,
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AwaitingConfirmationResponseDto) },
        { $ref: getSchemaPath(PlanCreatedResponseDto) },
        { $ref: getSchemaPath(PlanCancelledResponseDto) },
      ],
    },
  })
  handle(
    @Session() session: UserSession,
    @Body() dto: PracticePlannerRequestDto,
  ): Promise<PracticePlannerResponse> {
    return this.service.handleRequest(session.user.id, dto);
  }
}
