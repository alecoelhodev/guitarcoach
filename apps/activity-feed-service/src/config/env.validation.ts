import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  RABBITMQ_URL: z.url(),
  MONGODB_URL: z.url(),
});

export type EnvironmentVariables = z.infer<typeof envSchema>;

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${issues}`);
  }

  return result.data;
}
