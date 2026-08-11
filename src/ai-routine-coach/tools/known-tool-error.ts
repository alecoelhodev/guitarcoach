import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

const KNOWN_TOOL_ERROR_TYPES = [
  BadRequestException,
  NotFoundException,
  ConflictException,
] as const;

// The `create_routine` tool must never claim success and must never leave an
// unexpected error unnoticed. Domain-expected failures (task not found,
// invalid duration, ownership conflict) are converted into a normal
// `{ success: false, error }` tool result the model has to react to and
// report truthfully. Anything else is a genuine infra failure and should
// propagate out of the tool, out of the SDK's run(), and become a 500 at the
// controller boundary rather than being silently absorbed here.
export function isKnownToolError(error: unknown): error is HttpException {
  return KNOWN_TOOL_ERROR_TYPES.some((ctor) => error instanceof ctor);
}
