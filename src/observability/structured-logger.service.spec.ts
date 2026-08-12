import { Logger } from '@nestjs/common';
import type { LogLevel } from '@nestjs/common';
import { RequestContext } from './request-context';
import { StructuredLoggerService } from './structured-logger.service';

function readEntries(spy: jest.SpyInstance): Record<string, unknown>[] {
  return (spy.mock.calls as unknown[][]).map((call) => {
    const [line] = call as [string];
    return JSON.parse(line.trim()) as Record<string, unknown>;
  });
}

describe('StructuredLoggerService', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('emits a JSON line to stdout with the base structured fields', () => {
    const logger = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      'log',
    );

    logger.log('hello world', 'SomeContext');

    const [entry] = readEntries(stdoutSpy);
    expect(entry).toMatchObject({
      level: 'log',
      service: 'guitar-coach-api',
      environment: 'test',
      context: 'SomeContext',
      message: 'hello world',
    });
    expect(typeof entry.timestamp).toBe('string');
  });

  it('routes error/fatal levels to stderr and everything else to stdout', () => {
    const logger = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      'verbose',
    );

    logger.warn('a warning', 'Ctx');
    logger.error('an error', 'Ctx');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults to "log" level instead of going silent when given an unrecognized/undefined level', () => {
    const logger = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      undefined as unknown as LogLevel,
    );

    logger.log('still visible', 'Ctx');

    expect(readEntries(stdoutSpy)).toHaveLength(1);
  });

  it('filters out messages below the configured minimum level', () => {
    const logger = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      'warn',
    );

    logger.debug('too quiet', 'Ctx');
    logger.log('still too quiet', 'Ctx');
    logger.warn('loud enough', 'Ctx');

    expect(readEntries(stdoutSpy)).toHaveLength(1);
    expect(readEntries(stdoutSpy)[0].message).toBe('loud enough');
  });

  it("mirrors Nest's Logger convention: a trailing string optionalParam is the context, the rest is metadata", () => {
    const logger = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      'log',
    );

    logger.log('message', { userId: 'abc', count: 3 }, 'TasksService');

    const [entry] = readEntries(stdoutSpy);
    expect(entry.context).toBe('TasksService');
    expect(entry.meta).toEqual({ userId: 'abc', count: 3 });
  });

  it('extracts message/stack from an Error passed as the log message', () => {
    const logger = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      'log',
    );

    logger.error(new Error('boom'), 'SomeService');

    const [entry] = readEntries(
      stdoutSpy.mock.calls.length ? stdoutSpy : stderrSpy,
    );
    expect(entry.message).toBe('boom');
    expect(typeof entry.stack).toBe('string');
  });

  it('redacts sensitive fields in the metadata before serializing', () => {
    const logger = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      'log',
    );

    logger.log(
      'login attempt',
      { password: 'hunter2', userId: 'u1' },
      'AuthService',
    );

    const [entry] = readEntries(stdoutSpy);
    expect((entry.meta as { password: string }).password).toBe('[REDACTED]');
    expect((entry.meta as { userId: string }).userId).toBe('u1');
  });

  it('attaches requestId/correlationId from RequestContext when present', () => {
    const logger = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      'log',
    );

    RequestContext.run({ requestId: 'req-1', correlationId: 'corr-1' }, () => {
      logger.log('inside a request', 'Ctx');
    });

    const [entry] = readEntries(stdoutSpy);
    expect(entry.requestId).toBe('req-1');
    expect(entry.correlationId).toBe('corr-1');
  });

  it("integrates with Nest's per-class Logger wrapper", () => {
    const structured = new StructuredLoggerService(
      'guitar-coach-api',
      'test',
      'log',
    );
    const classLogger = new Logger('MyClass');

    Logger.overrideLogger(structured);

    classLogger.log('from a class logger', { extra: true });

    const [entry] = readEntries(stdoutSpy);
    expect(entry.context).toBe('MyClass');
    expect(entry.meta).toEqual({ extra: true });
  });
});
