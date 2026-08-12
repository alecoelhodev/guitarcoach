import { HttpStatus } from '@nestjs/common';

/**
 * Stable, client-facing error codes for `HttpExceptionFilter`'s normalized
 * response shape. Keyed off HTTP status rather than guessed per-exception, so
 * every existing `NotFoundException`/`ConflictException`/etc. thrown by
 * services (via the per-service `isPrismaErrorCode` pattern, or otherwise)
 * gets a deterministic code without those services changing anything.
 */
export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  BAD_GATEWAY = 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
  [HttpStatus.BAD_GATEWAY]: ErrorCode.BAD_GATEWAY,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
  [HttpStatus.GATEWAY_TIMEOUT]: ErrorCode.GATEWAY_TIMEOUT,
};

export function errorCodeForStatus(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR;
}
