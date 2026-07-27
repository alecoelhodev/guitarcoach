import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  displayName?: string;
}
