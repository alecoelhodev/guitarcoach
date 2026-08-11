import { z } from 'zod';

// Wire + business schema for the create_routine custom tool's arguments.
// Deliberately has no `userId` field: the authenticated user is always
// injected server-side by CreateRoutineTool.execute(userId, ...), never
// accepted from the model. Unlike PracticePlanSchema, these constraints are
// enforced directly (zodResponsesFunction sends this as a strict tool
// schema, and CreateRoutineTool re-validates with this same schema before
// executing anything).
export const CreateRoutineTaskArgsSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000),
  durationMinutes: z.number().int().positive(),
});

export const CreateRoutineArgsSchema = z.object({
  title: z.string().min(2).max(200),
  notes: z.string().max(2000),
  tasks: z.array(CreateRoutineTaskArgsSchema).min(1),
});

export type CreateRoutineArgs = z.infer<typeof CreateRoutineArgsSchema>;

export interface CreateRoutineResult {
  routineId: string;
  title: string;
  taskCount: number;
}
