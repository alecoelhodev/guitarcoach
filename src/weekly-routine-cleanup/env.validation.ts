import { z } from 'zod';

// A dedicated, minimal schema rather than reusing src/config/env.validation.ts's
// validate() — that schema requires BETTER_AUTH_SECRET/REDIS_URL/RABBITMQ_URL/GCS
// vars this job never touches. Keeping the job's own schema to exactly what it
// needs keeps its Secret Manager/IAM footprint minimal (least privilege).
export const envSchema = z.object({
  DATABASE_URL: z.url(),
  ROUTINE_CLEANUP_TIME_ZONE: z.string().min(1).default('UTC'),
  CLEANUP_WEEK_START: z.string().optional(),
});

export type WeeklyRoutineCleanupEnvironmentVariables = z.infer<
  typeof envSchema
>;

export function validate(
  config: Record<string, unknown>,
): WeeklyRoutineCleanupEnvironmentVariables {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${issues}`);
  }

  return result.data;
}
