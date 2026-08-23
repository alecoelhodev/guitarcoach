import { ApiProperty } from '@nestjs/swagger';
import { TaskResponseDto } from '../../tasks/dto/task-response.dto';

export class RoutineTaskResponseDto {
  routineId: string;
  taskId: string;
  position: number;

  @ApiProperty({ required: false, nullable: true })
  targetDurationMinutes?: number | null;

  createdAt: Date;
  updatedAt: Date;
}

export class RoutineTaskWithTaskResponseDto extends RoutineTaskResponseDto {
  @ApiProperty({ type: () => TaskResponseDto })
  task: TaskResponseDto;
}
