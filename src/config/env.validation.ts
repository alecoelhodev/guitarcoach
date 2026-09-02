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
  // Browser origins allowed to send the session cookie, comma-separated. Required
  // because CORS credentials cannot be combined with a wildcard origin, so every web
  // client has to be named. Native clients don't use CORS and are unaffected.
  // Parsed here rather than at each use site so `enableCors()` and Better Auth's
  // `trustedOrigins` consume the exact same list — a value trimmed by one and not
  // the other passes preflight and then 403s the real request.
  CORS_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .refine((origins) => origins.length > 0, {
      message: 'must list at least one origin',
    }),
  REDIS_URL: z.url(),
  RABBITMQ_URL: z.url(),
  CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(600_000)
    .default(300_000),
  GCP_PROJECT_ID: z.string().min(1),
  GCS_RECORDINGS_BUCKET: z.string().min(1),
  RECORDING_UPLOAD_MAX_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(900),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HEALTH_MEMORY_HEAP_THRESHOLD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(300 * 1024 * 1024),
  HEALTH_MEMORY_RSS_THRESHOLD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(300 * 1024 * 1024),
  LOG_LEVEL: z
    .enum(['verbose', 'debug', 'log', 'warn', 'error', 'fatal'])
    .default('log'),
  // z.coerce.boolean() would coerce the string "false" to `true` (any
  // non-empty string is JS-truthy) — require an explicit true/false string.
  METRICS_EXPORT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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
