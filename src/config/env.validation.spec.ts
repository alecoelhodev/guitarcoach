import { validate } from './env.validation';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?schema=public';
const BETTER_AUTH_SECRET = 'a'.repeat(32);
const BETTER_AUTH_URL = 'http://localhost:3000';
const REDIS_URL = 'redis://localhost:6379';

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
      REDIS_URL,
    });

    expect(result).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      API_VERSION: 'v1',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      REDIS_URL,
      CACHE_TTL_MS: 300_000,
    });
  });

  it('fails when NODE_ENV is missing', () => {
    expect(() =>
      validate({
        PORT: '3000',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        REDIS_URL,
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
        REDIS_URL,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        REDIS_URL,
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
        REDIS_URL,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when BETTER_AUTH_SECRET is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_URL,
        REDIS_URL,
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
        REDIS_URL,
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
        REDIS_URL,
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when REDIS_URL is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
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
        REDIS_URL: 'not-a-url',
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
        REDIS_URL,
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
        REDIS_URL,
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
      REDIS_URL,
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
      REDIS_URL,
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
      REDIS_URL,
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
        REDIS_URL,
      }),
    ).toThrow('Environment validation failed');
  });

  it('applies defaults for PORT, API_PREFIX, and API_VERSION when omitted', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      REDIS_URL,
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
      REDIS_URL,
    });

    expect(result.CACHE_TTL_MS).toBe(300_000);
  });
});
