import { validate } from './env.validation';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?schema=public';
const BETTER_AUTH_SECRET = 'a'.repeat(32);
const BETTER_AUTH_URL = 'http://localhost:3000';
const CORS_ORIGINS = 'http://localhost:8081';
const CORS_ORIGINS_PARSED = ['http://localhost:8081'];
const REDIS_URL = 'redis://localhost:6379';
const RABBITMQ_URL = 'amqp://user:pass@localhost:5672';
const GCP_PROJECT_ID = 'guitar-coach-dev';
const GCS_RECORDINGS_BUCKET = 'guitar-coach-recordings-dev';
const OPENAI_API_KEY = 'sk-test-key';
const OPENAI_MODEL = 'gpt-4.1';

describe('validate', () => {
  it('succeeds for a valid configuration', () => {
    const result = validate({
      NODE_ENV: 'development',
      PORT: '3000',
      API_PREFIX: 'api',
      API_VERSION: 'v1',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      API_VERSION: 'v1',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS: CORS_ORIGINS_PARSED,
      REDIS_URL,
      RABBITMQ_URL,
      CACHE_TTL_MS: 300_000,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      RECORDING_UPLOAD_MAX_SIZE_BYTES: 52_428_800,
      RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS: 900,
      OPENAI_API_KEY,
      OPENAI_MODEL,
      OPENAI_REQUEST_TIMEOUT_MS: 30_000,
      HEALTH_MEMORY_HEAP_THRESHOLD_BYTES: 314_572_800,
      HEALTH_MEMORY_RSS_THRESHOLD_BYTES: 314_572_800,
      LOG_LEVEL: 'log',
      METRICS_EXPORT_ENABLED: false,
    });
  });

  it('fails when NODE_ENV is missing', () => {
    expect(() =>
      validate({
        PORT: '3000',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when NODE_ENV is invalid', () => {
    expect(() =>
      validate({
        NODE_ENV: 'staging',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when DATABASE_URL is not a valid URL', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL: 'not-a-url',
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when BETTER_AUTH_SECRET is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when BETTER_AUTH_SECRET is shorter than 32 characters', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET: 'too-short',
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when BETTER_AUTH_URL is not a valid URL', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: 'not-a-url',
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when CORS_ORIGINS is missing', () => {
    // Required rather than defaulted: enableCors() must never fall back to a wildcard
    // origin, which browsers refuse to pair with credentialed cookies.
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
        OPENAI_API_KEY,
        OPENAI_MODEL,
      }),
    ).toThrow('CORS_ORIGINS');
  });

  it('parses CORS_ORIGINS into a trimmed list, dropping empty entries', () => {
    // Better Auth's own comma-split does no trimming, so the list has to arrive
    // already normalized for enableCors() and trustedOrigins to agree on it.
    const result = validate({
      NODE_ENV: 'development',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS: 'http://localhost:8081, https://app.example.com,',
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.CORS_ORIGINS).toEqual([
      'http://localhost:8081',
      'https://app.example.com',
    ]);
  });

  it('fails when CORS_ORIGINS lists no usable origin', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS: ' , ',
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
        OPENAI_API_KEY,
        OPENAI_MODEL,
      }),
    ).toThrow('CORS_ORIGINS');
  });

  it('fails when REDIS_URL is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when REDIS_URL is not a valid URL', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL: 'not-a-url',
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when RABBITMQ_URL is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when RABBITMQ_URL is not a valid URL', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL: 'not-a-url',
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when GCP_PROJECT_ID is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when GCS_RECORDINGS_BUCKET is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when CACHE_TTL_MS is below the 1 minute minimum', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
        CACHE_TTL_MS: '1000',
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when CACHE_TTL_MS is above the 10 minute maximum', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
        CACHE_TTL_MS: '700000',
      }),
    ).toThrow('Environment validation failed');
  });

  it('accepts a CACHE_TTL_MS within the 1-10 minute range', () => {
    const result = validate({
      NODE_ENV: 'development',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
      CACHE_TTL_MS: '120000',
    });

    expect(result.CACHE_TTL_MS).toBe(120_000);
  });

  it('converts a string PORT value to a number', () => {
    const result = validate({
      NODE_ENV: 'development',
      PORT: '4000',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.PORT).toBe(4000);
    expect(typeof result.PORT).toBe('number');
  });

  it('accepts a valid TEST_DATABASE_URL', () => {
    const TEST_DATABASE_URL =
      'postgresql://user:pass@localhost:5432/db_test?schema=public';

    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      TEST_DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.TEST_DATABASE_URL).toBe(TEST_DATABASE_URL);
  });

  it('fails when TEST_DATABASE_URL is not a valid URL', () => {
    expect(() =>
      validate({
        NODE_ENV: 'test',
        DATABASE_URL,
        TEST_DATABASE_URL: 'not-a-url',
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
      }),
    ).toThrow('Environment validation failed');
  });

  it('applies defaults for PORT, API_PREFIX, and API_VERSION when omitted', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.PORT).toBe(3000);
    expect(result.API_PREFIX).toBe('api');
    expect(result.API_VERSION).toBe('v1');
  });

  it('applies the default CACHE_TTL_MS when omitted', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.CACHE_TTL_MS).toBe(300_000);
  });

  it('applies defaults for RECORDING_UPLOAD_MAX_SIZE_BYTES and RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS when omitted', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.RECORDING_UPLOAD_MAX_SIZE_BYTES).toBe(52_428_800);
    expect(result.RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS).toBe(900);
  });

  it('fails when OPENAI_API_KEY is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
        OPENAI_MODEL,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when OPENAI_MODEL is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
        OPENAI_API_KEY,
      }),
    ).toThrow('Environment validation failed');
  });

  it('applies the default OPENAI_REQUEST_TIMEOUT_MS when omitted', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.OPENAI_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('applies defaults for HEALTH_MEMORY_HEAP_THRESHOLD_BYTES and HEALTH_MEMORY_RSS_THRESHOLD_BYTES when omitted', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.HEALTH_MEMORY_HEAP_THRESHOLD_BYTES).toBe(314_572_800);
    expect(result.HEALTH_MEMORY_RSS_THRESHOLD_BYTES).toBe(314_572_800);
  });

  it('applies defaults for LOG_LEVEL and METRICS_EXPORT_ENABLED when omitted', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
    });

    expect(result.LOG_LEVEL).toBe('log');
    expect(result.METRICS_EXPORT_ENABLED).toBe(false);
  });

  it('fails when LOG_LEVEL is not one of the known levels', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        CORS_ORIGINS,
        REDIS_URL,
        RABBITMQ_URL,
        GCP_PROJECT_ID,
        GCS_RECORDINGS_BUCKET,
        LOG_LEVEL: 'trace',
      }),
    ).toThrow('Environment validation failed');
  });

  it('parses METRICS_EXPORT_ENABLED="true" as a boolean true', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
      METRICS_EXPORT_ENABLED: 'true',
    });

    expect(result.METRICS_EXPORT_ENABLED).toBe(true);
  });

  it('does not fall back to JS-truthy coercion for METRICS_EXPORT_ENABLED="false"', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      CORS_ORIGINS,
      REDIS_URL,
      RABBITMQ_URL,
      GCP_PROJECT_ID,
      GCS_RECORDINGS_BUCKET,
      OPENAI_API_KEY,
      OPENAI_MODEL,
      METRICS_EXPORT_ENABLED: 'false',
    });

    expect(result.METRICS_EXPORT_ENABLED).toBe(false);
  });
});
