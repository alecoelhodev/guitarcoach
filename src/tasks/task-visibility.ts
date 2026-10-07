import { Prisma } from '../generated/prisma/client';

/**
 * The tasks `userId` may see or use: the shared library, plus private tasks the AI planner
 * created for them. Every path that accepts a `taskId` from a user filters through this, so
 * another user's private task reads as "not found", never "forbidden".
 */
export function visibleTo(userId: string): Prisma.TaskWhereInput {
  return { OR: [{ ownerId: null }, { ownerId: userId }] };
}

/** Shared library tasks only: what the library lists and the routine coach chooses from. */
export const SHARED_TASKS: Prisma.TaskWhereInput = { ownerId: null };
