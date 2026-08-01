import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateRoutineTaskDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  position?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetDurationMinutes?: number;
}
