import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { errorCodeForStatus } from './error-codes';
import { RequestContext } from './request-context';
import { SecurityEventLogger } from './security-event.logger';

interface NormalizedErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId?: string;
}

const GENERIC_MESSAGE = 'An unexpected error occurred';

// Typed as plain `number` (not the HttpStatus enum) so comparing against the
// `status: number` params below doesn't trip no-unsafe-enum-comparison.
const UNAUTHORIZED_STATUS: number = HttpStatus.UNAUTHORIZED;
const FORBIDDEN_STATUS: number = HttpStatus.FORBIDDEN;

/**
 * Global response-shape normalization filter (spec section 6). This is
 * deliberately NOT the Prisma-error-translation mechanism CLAUDE.md's
 * "Forbidden shortcuts" warns against adding globally — each service still
 * translates its own Prisma error codes via the local `isPrismaErrorCode`
 * pattern before anything reaches here. This filter only standardizes the
 * final client-facing JSON body for whatever `HttpException` (already
 * translated) or unknown error reaches it, and safely defaults anything
 * unrecognized (including today's "unmapped Prisma code -> rethrow"
 * fallthrough) to a generic 500 instead of leaking internals.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly securityEvents: SecurityEventLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<Request>();

    const status = this.resolveStatus(exception);
    const body: NormalizedErrorBody = {
      statusCode: status,
      code: errorCodeForStatus(status),
      message: this.resolveClientMessage(exception, status),
      requestId: RequestContext.getRequestId(),
    };

    this.logInternally(exception, status, request);
    this.maybeLogSecurityEvent(status, request);

    response.status(status).json(body);
  }

  private resolveStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveClientMessage(exception: unknown, status: number): string {
    // Anything 5xx (known or not), or anything that isn't a Nest HttpException
    // at all (e.g. an unmapped Prisma error, a raw thrown Error), never
    // leaks its internal message to the client.
    if (status >= 500 || !(exception instanceof HttpException)) {
      return GENERIC_MESSAGE;
    }

    const httpResponse = exception.getResponse();
    if (typeof httpResponse === 'string') {
      return httpResponse;
    }
    if (
      httpResponse &&
      typeof httpResponse === 'object' &&
      'message' in httpResponse
    ) {
      const { message } = httpResponse;
      if (Array.isArray(message)) {
        return message.join('; ');
      }
      if (typeof message === 'string') {
        return message;
      }
    }
    return exception.message;
  }

  private logInternally(
    exception: unknown,
    status: number,
    request: Request,
  ): void {
    const context = {
      statusCode: status,
      method: request.method,
      route: this.resolveRoute(request),
    };

    if (exception instanceof Error) {
      this.logger.error(exception, context);
    } else {
      this.logger.error('Non-Error exception thrown', {
        ...context,
        exception,
      });
    }
  }

  private maybeLogSecurityEvent(status: number, request: Request): void {
    const isUnauthorized = status === UNAUTHORIZED_STATUS;
    const isForbidden = status === FORBIDDEN_STATUS;
    if (!isUnauthorized && !isForbidden) {
      return;
    }

    this.securityEvents.log({
      eventType: isUnauthorized ? 'http.unauthorized' : 'http.forbidden',
      outcome: 'failure',
      actorId: (request as { user?: { id?: string } }).user?.id,
      targetType: 'route',
      targetId: this.resolveRoute(request),
    });
  }

  private resolveRoute(request: Request): string {
    return (
      (request as { route?: { path?: string } }).route?.path ?? request.path
    );
  }
}
