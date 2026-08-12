import { Injectable, LoggerService } from '@nestjs/common';
import type { LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { redact } from './redaction.util';
import { RequestContext } from './request-context';

const LEVEL_ORDER: Record<LogLevel, number> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const DEFAULT_LEVEL: LogLevel = 'log';

/**
 * Nest `LoggerService` implementation emitting one JSON line per call. Set via
 * `app.useLogger(...)` in `main.ts` (and the weekly-cleanup job's `main.ts`), so
 * every existing `new Logger(ClassName.name)` call site across the app starts
 * emitting structured logs with zero changes to those call sites.
 *
 * Nest's per-class `Logger` wrapper always appends its bound context string as
 * the last argument before forwarding to the app-level logger set via
 * `useLogger` — so "the last arg is a string" is how we recover the calling
 * class's name without callers doing anything special.
 */
@Injectable()
export class StructuredLoggerService implements LoggerService {
  private minLevel: LogLevel;

  constructor(
    private readonly serviceName: string,
    private readonly environment: string,
    logLevel: LogLevel,
  ) {
    // Callers whose ConfigService was built from a narrower env schema that
    // doesn't declare LOG_LEVEL (e.g. the weekly-cleanup job's deliberately
    // minimal schema) get `undefined` back from `.get()` at runtime despite
    // the type saying `LogLevel` — falling back here means logging degrades
    // to a sane default instead of silently emitting nothing.
    this.minLevel =
      LEVEL_ORDER[logLevel] !== undefined ? logLevel : DEFAULT_LEVEL;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  setLogLevels(levels: LogLevel[]): void {
    const lowest = levels.reduce<LogLevel | undefined>((min, level) => {
      return !min || LEVEL_ORDER[level] < LEVEL_ORDER[min] ? level : min;
    }, undefined);
    if (lowest) {
      this.minLevel = lowest;
    }
  }

  private isEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  private write(level: LogLevel, message: unknown, args: unknown[]): void {
    if (!this.isEnabled(level)) {
      return;
    }

    const { context, meta } = this.parseArgs(args);
    const requestContext = RequestContext.get();
    const isErrorMessage = message instanceof Error;

    const entry = redact({
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      environment: this.environment,
      context,
      requestId: requestContext?.requestId,
      correlationId: requestContext?.correlationId,
      message: isErrorMessage ? message.message : message,
      ...(isErrorMessage ? { stack: message.stack } : {}),
      ...(meta !== undefined ? { meta } : {}),
    });

    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  private parseArgs(args: unknown[]): { context?: string; meta?: unknown } {
    if (args.length === 0) {
      return {};
    }

    const last = args[args.length - 1];
    if (typeof last === 'string') {
      return { context: last, meta: this.collapseMeta(args.slice(0, -1)) };
    }
    return { meta: this.collapseMeta(args) };
  }

  private collapseMeta(rest: unknown[]): unknown {
    if (rest.length === 0) {
      return undefined;
    }
    return rest.length === 1 ? rest[0] : rest;
  }
}

export function createStructuredLogger(
  configService: ConfigService<EnvironmentVariables, true>,
): StructuredLoggerService {
  return new StructuredLoggerService(
    'guitar-coach-api',
    configService.get('NODE_ENV', { infer: true }),
    configService.get('LOG_LEVEL', { infer: true }),
  );
}
