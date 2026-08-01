import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// No longer backs a create endpoint (user creation now happens via Better
// Auth's sign-up flow) — kept as the base shape for UpdateUserDto's
// PartialType(), which reads its validators at runtime.
export class CreateUserDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  displayName: string;
}
