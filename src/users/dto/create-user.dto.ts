import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  displayName: string;
}
