import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class DeletePracticeSessionsQueryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  title: string;
}
