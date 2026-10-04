import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class UpdateRoutineTaskDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  position?: number;

  /** `null` clears the target; omitting the field leaves it unchanged. */
  @ApiProperty({ required: false, nullable: true, type: Number, minimum: 1 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetDurationMinutes?: number | null;
}
