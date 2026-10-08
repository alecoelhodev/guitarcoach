import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, IsUrl, Length, ValidateIf } from 'class-validator';
import { TaskCategory, TaskDifficulty } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Explicit rather than PartialType(CreateTaskDto): an edit must be able to clear the
// optional fields, which means `null`, and @IsOptional() alone would also have let
// `title: null` through to the NOT NULL column as a 500.
const present = (_: object, value: unknown) => value !== undefined;
const set = (_: object, value: unknown) =>
  value !== undefined && value !== null;

export class UpdateTaskDto {
  /** Can be changed, never cleared. */
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  title?: string;

  /** `null` clears it. */
  @ApiProperty({ enum: TaskCategory, required: false, nullable: true })
  @ValidateIf(set)
  @Transform(trim)
  @IsEnum(TaskCategory)
  category?: TaskCategory | null;

  /** `null` clears it. */
  @ApiProperty({ enum: TaskDifficulty, required: false, nullable: true })
  @ValidateIf(set)
  @Transform(trim)
  @IsEnum(TaskDifficulty)
  difficulty?: TaskDifficulty | null;

  /** `null` clears it. */
  @ApiProperty({ required: false, nullable: true, type: String })
  @ValidateIf(set)
  @Transform(trim)
  @IsUrl()
  referenceLink?: string | null;

  /** `""` clears it. */
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  description?: string;
}
