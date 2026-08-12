import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { meters } from './metrics/meters';

/**
 * One structured log line + `http_requests_total`/`http_request_duration_ms`
 * per request. Listens for the response's `finish` event rather than hooking
 * the interceptor's success/error channel, so the recorded statusCode is
 * always the final one actually sent to the client — including on the error
 * path, after `HttpExceptionFilter` has already run.
 */
@Injectable()
export class HttpObservabilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpObservabilityInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const startedAt = Date.now();
    const route = this.resolveRoute(request);
    const method = request.method;

    response.once('finish', () => {
      const durationMs = Date.now() - startedAt;
      const statusCode = response.statusCode;

      this.logger.log('request completed', {
        route,
        method,
        statusCode,
        durationMs,
      });

      meters.httpRequestsTotal.add(1, { route, method, statusCode });
      meters.httpRequestDurationMs.record(durationMs, { route, method });
    });

    return next.handle();
  }

  private resolveRoute(request: Request): string {
    return (
      (request as { route?: { path?: string } }).route?.path ?? request.path
    );
  }
}
