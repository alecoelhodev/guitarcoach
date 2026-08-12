import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';

// Bounded, restricted charset: safe to log/propagate without risking log-line
// injection or breaking downstream header/JSON parsing. Not a strict UUID
// check, since some clients propagate their own trace-id formats.
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Registered first via `app.use(...)` in `main.ts`, before the auth guard, so
 * every request — including ones that fail authentication — gets a request ID
 * in its logs and response headers. `correlationId` starts equal to `requestId`
 * at the HTTP boundary and is threaded into the RabbitMQ envelope by
 * `RoutineCreatedProducer` so the whole HTTP -> queue -> worker chain shares it.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId =
    incoming && SAFE_REQUEST_ID_PATTERN.test(incoming)
      ? incoming
      : randomUUID();

  res.setHeader(REQUEST_ID_HEADER, requestId);

  RequestContext.run({ requestId, correlationId: requestId }, () => {
    next();
  });
}
