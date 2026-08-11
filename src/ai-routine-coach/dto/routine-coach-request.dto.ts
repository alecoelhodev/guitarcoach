import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RoutineCoachRequestDto {
  @Transform(trim)
  @IsString()
  @Length(3, 1000)
  message: string;
}
