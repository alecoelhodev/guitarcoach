import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { TaskCategory, TaskDifficulty } from '../../generated/prisma/enums';

export class TaskResponseDto {
  id: string;
  title: string;

  @ApiProperty({ enum: TaskCategory, required: false, nullable: true })
  category?: TaskCategory | null;

  @ApiProperty({ enum: TaskDifficulty, required: false, nullable: true })
  difficulty?: TaskDifficulty | null;

  @ApiProperty({ required: false, nullable: true })
  referenceLink?: string | null;

  @ApiProperty({ required: false, nullable: true })
  description?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedTasksResponseDto {
  @ApiProperty({ type: () => [TaskResponseDto] })
  data: TaskResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
