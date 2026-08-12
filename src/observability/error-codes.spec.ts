import { HttpStatus } from '@nestjs/common';
import { ErrorCode, errorCodeForStatus } from './error-codes';

describe('errorCodeForStatus', () => {
  it.each([
    [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR],
    [HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED],
    [HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN],
    [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
    [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.TOO_MANY_REQUESTS],
    [HttpStatus.BAD_GATEWAY, ErrorCode.BAD_GATEWAY],
    [HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE],
    [HttpStatus.GATEWAY_TIMEOUT, ErrorCode.GATEWAY_TIMEOUT],
    [HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR],
  ])('maps status %i to %s', (status, expected) => {
    expect(errorCodeForStatus(status)).toBe(expected);
  });

  it('defaults unmapped statuses to INTERNAL_ERROR rather than leaking a raw code', () => {
    expect(errorCodeForStatus(599)).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
