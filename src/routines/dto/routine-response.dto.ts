import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { RoutineStatus } from '../../generated/prisma/enums';

export class RoutineResponseDto {
  id: string;
  userId: string;
  title: string;

  @ApiProperty({ enum: RoutineStatus })
  status: RoutineStatus;

  @ApiProperty({ required: false, nullable: true })
  notes?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedRoutinesResponseDto {
  @ApiProperty({ type: () => [RoutineResponseDto] })
  data: RoutineResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
