import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { RoutineStatus } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateRoutineDto {
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @Transform(trim)
  @IsEnum(RoutineStatus)
  status?: RoutineStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  notes?: string;
}
