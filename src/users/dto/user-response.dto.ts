import { ApiProperty } from '@nestjs/swagger';

// Explicitly whitelisted, not the raw Prisma `User` row: secrets (password
// hash, OAuth tokens) live on the separate `Account` model and are never
// queried here, but listing fields out by hand means that stays true even if
// a future `include`/schema change adds something to `User` that shouldn't
// be public.
export class UserResponseDto {
  id: string;

  @ApiProperty({ required: false, nullable: true })
  displayName?: string | null;

  email: string;
  emailVerified: boolean;

  @ApiProperty({ required: false, nullable: true })
  image?: string | null;

  role: string;
  banned: boolean;

  @ApiProperty({ required: false, nullable: true })
  banReason?: string | null;

  @ApiProperty({ required: false, nullable: true })
  banExpires?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

// GET /users/me returns better-auth's session user, which is NOT the same
// shape as the admin-facing Prisma `User` above despite both describing the
// same account: better-auth exposes its own canonical `name` field here
// (confirmed against `UserSession['user']`'s inferred type) even though
// auth.ts's `fields: { name: 'displayName' }` maps that canonical field onto
// the `displayName` Prisma column under the hood — and the admin plugin's
// ban fields aren't guaranteed present without typing the session as
// `UserSession<typeof auth>`, which this app doesn't do. Modeled separately
// rather than assumed identical to UserResponseDto.
export class MeResponseDto {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;

  @ApiProperty({ required: false, nullable: true })
  image?: string | null;

  @ApiProperty({ required: false, type: String })
  role?: string | string[];

  createdAt: Date;
  updatedAt: Date;
}
