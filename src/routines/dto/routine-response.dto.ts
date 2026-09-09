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

  /**
   * Task count and planned duration are derived, not stored. They are here
   * because every routine card in the client shows "4 tasks · 45 min", and
   * resolving that client-side would mean a request per card.
   *
   * Both are always present — a routine with no tasks reports 0/0 — so the
   * client never has to guard them.
   */
  taskCount: number;

  /** Sum of the routine tasks' `targetDurationMinutes`, counting nulls as 0. */
  totalTargetDurationMinutes: number;

  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedRoutinesResponseDto {
  @ApiProperty({ type: () => [RoutineResponseDto] })
  data: RoutineResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
