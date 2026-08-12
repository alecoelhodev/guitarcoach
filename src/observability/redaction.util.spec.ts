import { redact } from './redaction.util';

describe('redact', () => {
  it('redacts known sensitive keys at any nesting depth', () => {
    const input = {
      email: 'user@example.com',
      password: 'super-secret',
      nested: { apiKey: 'sk-123', refreshToken: 'rt-456', ok: 'fine' },
    };

    expect(redact(input)).toEqual({
      email: 'user@example.com',
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', refreshToken: '[REDACTED]', ok: 'fine' },
    });
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const input = [{ token: 'abc' }, { name: 'safe' }];

    expect(redact(input)).toEqual([{ token: '[REDACTED]' }, { name: 'safe' }]);
  });

  it('redacts credentials embedded in a URL string', () => {
    const input = 'postgresql://user:pw123@db.internal:5432/app';

    expect(redact(input)).toBe('postgresql://[REDACTED]@db.internal:5432/app');
  });

  it('leaves URLs without embedded credentials untouched', () => {
    const input = 'https://api.example.com/v1/resource';

    expect(redact(input)).toBe(input);
  });

  it('extracts a safe shape from Error instances, keeping the stack', () => {
    const error = new Error('boom');

    const result = redact(error) as {
      name: string;
      message: string;
      stack?: string;
    };

    expect(result.name).toBe('Error');
    expect(result.message).toBe('boom');
    expect(result.stack).toContain('Error: boom');
  });

  it('does not throw on circular references', () => {
    const input: Record<string, unknown> = { name: 'circular' };
    input.self = input;

    expect(() => redact(input)).not.toThrow();
    expect((redact(input) as { self: unknown }).self).toBe('[CIRCULAR]');
  });
});
