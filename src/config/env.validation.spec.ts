import { validate } from './env.validation';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?schema=public';
const BETTER_AUTH_SECRET = 'a'.repeat(32);
const BETTER_AUTH_URL = 'http://localhost:3000';

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
    });

    expect(result).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      API_VERSION: 'v1',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
    });
  });

  it('fails when NODE_ENV is missing', () => {
    expect(() =>
      validate({
        PORT: '3000',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
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
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
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
      }),
    ).toThrow('Environment validation failed');
  });

  it('fails when BETTER_AUTH_SECRET is missing', () => {
    expect(() =>
      validate({ NODE_ENV: 'development', DATABASE_URL, BETTER_AUTH_URL }),
    ).toThrow('Environment validation failed');
  });

  it('fails when BETTER_AUTH_SECRET is shorter than 32 characters', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL,
        BETTER_AUTH_SECRET: 'too-short',
        BETTER_AUTH_URL,
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
      }),
    ).toThrow('Environment validation failed');
  });

  it('converts a string PORT value to a number', () => {
    const result = validate({
      NODE_ENV: 'development',
      PORT: '4000',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
    });

    expect(result.PORT).toBe(4000);
    expect(typeof result.PORT).toBe('number');
  });

  it('applies defaults for PORT, API_PREFIX, and API_VERSION when omitted', () => {
    const result = validate({
      NODE_ENV: 'test',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
    });

    expect(result.PORT).toBe(3000);
    expect(result.API_PREFIX).toBe('api');
    expect(result.API_VERSION).toBe('v1');
  });
});
