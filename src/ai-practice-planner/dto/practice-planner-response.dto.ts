import { ApiProperty } from '@nestjs/swagger';

export class PracticePlanTaskResponseDto {
  title: string;
  description: string;
  durationMinutes: number;
}

export class PracticePlanResponseDto {
  title: string;
  summary: string;
  totalDurationMinutes: number;

  @ApiProperty({ type: () => [PracticePlanTaskResponseDto] })
  tasks: PracticePlanTaskResponseDto[];

  requiresConfirmation: boolean;
}

export class CreatedRoutineResultResponseDto {
  routineId: string;
  title: string;
  taskCount: number;
}

// PracticePlannerResponse is a discriminated union on `status` — Swagger has
// no native discriminated-union support, so each variant gets its own class
// and the controller wires them together with an explicit oneOf schema
// (see ai-practice-planner.controller.ts) rather than one merged shape,
// which would make every field look optional regardless of `status`.
export class AwaitingConfirmationResponseDto {
  @ApiProperty({ enum: ['awaiting_confirmation'] })
  status: 'awaiting_confirmation';

  @ApiProperty({ type: () => PracticePlanResponseDto })
  plan: PracticePlanResponseDto;

  previousResponseId: string;
}

export class PlanCreatedResponseDto {
  @ApiProperty({ enum: ['created'] })
  status: 'created';

  @ApiProperty({ type: () => CreatedRoutineResultResponseDto })
  routine: CreatedRoutineResultResponseDto;
}

export class PlanCancelledResponseDto {
  @ApiProperty({ enum: ['cancelled'] })
  status: 'cancelled';
}
