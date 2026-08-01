import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().min(1).default('api'),
  API_VERSION: z.string().min(1).default('v1'),
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  REDIS_URL: z.url(),
  RABBITMQ_URL: z.url(),
  CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(600_000)
    .default(300_000),
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
