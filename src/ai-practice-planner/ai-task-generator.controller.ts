import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { AiRateLimitGuard } from '../ai-rate-limit/ai-rate-limit.guard';
import { AiTaskGeneratorService } from './ai-task-generator.service';
import {
  TaskGeneratorRequestDto,
  TaskGeneratorResponseDto,
} from './dto/task-generator.dto';

@Controller('ai/task-generator')
@UseGuards(AiRateLimitGuard)
export class AiTaskGeneratorController {
  constructor(private readonly service: AiTaskGeneratorService) {}

  // 200, not 201: it returns drafts and creates nothing.
  @Post()
  @Roles(['admin'])
  @HttpCode(HttpStatus.OK)
  async generate(
    @Body() dto: TaskGeneratorRequestDto,
  ): Promise<TaskGeneratorResponseDto> {
    return { drafts: await this.service.generate(dto.prompt, dto.count) };
  }
}
