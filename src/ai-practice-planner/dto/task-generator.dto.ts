import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { TaskCategory, TaskDifficulty } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const MAX_GENERATED_TASKS = 10;

export class TaskGeneratorRequestDto {
  /** What to practise, in plain words. */
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  prompt: string;

  /** How many task drafts to return. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_GENERATED_TASKS)
  count: number;
}

export class TaskDraftDto {
  title: string;
  description: string;

  @ApiProperty({ enum: TaskCategory })
  category: TaskCategory;

  @ApiProperty({ enum: TaskDifficulty })
  difficulty: TaskDifficulty;
}

export class TaskGeneratorResponseDto {
  @ApiProperty({ type: () => [TaskDraftDto] })
  drafts: TaskDraftDto[];
}
