import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreatePracticeSessionTaskDto } from './create-practice-session-task.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePracticeSessionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  routineId?: string;

  /** Elapsed practice time. */
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePracticeSessionTaskDto)
  tasks?: CreatePracticeSessionTaskDto[];
}
