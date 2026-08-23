import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

export class PracticeSessionTaskResponseDto {
  practiceSessionId: string;
  taskId: string;

  @ApiProperty({ required: false, nullable: true })
  durationMinutes?: number | null;

  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class PracticeSessionResponseDto {
  id: string;
  userId: string;

  @ApiProperty({ required: false, nullable: true })
  routineId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  title?: string | null;

  @ApiProperty({ required: false, nullable: true })
  notes?: string | null;

  createdAt: Date;
  updatedAt: Date;

  @ApiProperty({ type: () => [PracticeSessionTaskResponseDto] })
  sessionTasks: PracticeSessionTaskResponseDto[];
}

export class PaginatedPracticeSessionsResponseDto {
  @ApiProperty({ type: () => [PracticeSessionResponseDto] })
  data: PracticeSessionResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class DeleteResultResponseDto {
  deletedCount: number;
}
