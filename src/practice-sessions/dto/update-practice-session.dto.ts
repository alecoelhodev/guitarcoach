import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsString,
  Length,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreatePracticeSessionTaskDto } from './create-practice-session-task.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const present = (_: object, value: unknown) => value !== undefined;
const set = (_: object, value: unknown) =>
  value !== undefined && value !== null;

/** A resumed session's Finish. Omitted fields are left as they are. */
export class UpdatePracticeSessionDto {
  /** `null` clears it. */
  @ApiProperty({ required: false, nullable: true, type: String })
  @ValidateIf(set)
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title?: string | null;

  /** `null` clears it. */
  @ApiProperty({ required: false, nullable: true, type: String })
  @ValidateIf(set)
  @Transform(trim)
  @IsString()
  notes?: string | null;

  @ValidateIf(present)
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  /** Replaces the session's whole task list. */
  @ValidateIf(present)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePracticeSessionTaskDto)
  tasks?: CreatePracticeSessionTaskDto[];
}
