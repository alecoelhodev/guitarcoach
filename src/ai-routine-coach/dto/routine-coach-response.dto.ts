import { ApiProperty } from '@nestjs/swagger';

export class RoutineCoachResponseDto {
  message: string;

  @ApiProperty({ required: false })
  routineId?: string;

  @ApiProperty({ required: false })
  routineTitle?: string;

  @ApiProperty({ required: false })
  taskCount?: number;
}
