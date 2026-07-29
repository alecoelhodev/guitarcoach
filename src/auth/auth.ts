import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { PrismaService } from '../prisma/prisma.service';
import { sendResetPasswordEmail, sendVerificationEmail } from './email';

export function createAuth(prisma: PrismaService) {
  return betterAuth({
    basePath: '/auth',
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    advanced: {
      database: { generateId: false },
    },
    user: {
      fields: { name: 'displayName' },
    },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: sendResetPasswordEmail,
    },
    emailVerification: {
      sendVerificationEmail,
      sendOnSignUp: true,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
