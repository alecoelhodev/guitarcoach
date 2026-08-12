const REDACTED = '[REDACTED]';

// Matches key names, not values — case-insensitive, deliberately broad so a
// new sensitive-sounding field (e.g. `refreshToken`, `apiKey`) is redacted by
// default rather than requiring every call site to remember to opt in.
const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|authorization|cookie|api[-_]?key|credential|jwt/i;

// A URL with embedded userinfo (postgres://user:pass@host, amqp://user:pass@host, ...).
const CREDENTIALED_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i;

/**
 * Recursively redacts known-sensitive keys and credentialed URLs from a value
 * before it's serialized into a log line. Applied by `StructuredLoggerService`
 * to every log entry so no call site has to remember to redact manually.
 */
export function redact(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === 'string') {
    return redactCredentialedUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactCredentialedUrl(value.message),
      stack: value.stack,
    };
  }

  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) {
      return '[CIRCULAR]';
    }
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redact(entryValue, seen);
    }
    return output;
  }

  return value;
}

function redactCredentialedUrl(input: string): string {
  return CREDENTIALED_URL_PATTERN.test(input)
    ? input.replace(/\/\/[^/@\s]+@/, '//[REDACTED]@')
    : input;
}
