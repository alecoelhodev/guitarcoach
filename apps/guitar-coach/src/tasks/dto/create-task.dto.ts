import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { TaskCategory, TaskDifficulty } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTaskDto {
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @Transform(trim)
  @IsEnum(TaskCategory)
  category?: TaskCategory;

  @IsOptional()
  @Transform(trim)
  @IsEnum(TaskDifficulty)
  difficulty?: TaskDifficulty;

  @IsOptional()
  @Transform(trim)
  @IsUrl()
  referenceLink?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  description?: string;
}
