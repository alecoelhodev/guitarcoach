import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { HttpObservabilityInterceptor } from './http-observability.interceptor';
import { meters } from './metrics/meters';

interface FakeResponse {
  statusCode: number;
  once: (event: string, callback: () => void) => void;
  triggerFinish: () => void;
}

function buildContext(
  request: unknown,
  response: FakeResponse,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function buildResponse(): FakeResponse {
  let finishCallback: (() => void) | undefined;
  return {
    statusCode: 200,
    once: (event, callback) => {
      if (event === 'finish') {
        finishCallback = callback;
      }
    },
    triggerFinish: () => finishCallback?.(),
  };
}

describe('HttpObservabilityInterceptor', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records metrics only once the response finishes, using the final status code', () => {
    const interceptor = new HttpObservabilityInterceptor();
    const request = {
      method: 'GET',
      path: '/routines/1',
      route: { path: '/routines/:id' },
    };
    const response = buildResponse();
    const next: CallHandler = { handle: () => of('ok') };
    const addSpy = jest.spyOn(meters.httpRequestsTotal, 'add');
    const recordSpy = jest.spyOn(meters.httpRequestDurationMs, 'record');

    interceptor.intercept(buildContext(request, response), next).subscribe();
    expect(addSpy).not.toHaveBeenCalled();

    response.statusCode = 404;
    response.triggerFinish();

    expect(addSpy).toHaveBeenCalledWith(1, {
      route: '/routines/:id',
      method: 'GET',
      statusCode: 404,
    });
    expect(recordSpy).toHaveBeenCalledWith(expect.any(Number), {
      route: '/routines/:id',
      method: 'GET',
    });
  });

  it('falls back to request.path when no route was matched', () => {
    const interceptor = new HttpObservabilityInterceptor();
    const request = { method: 'GET', path: '/unmatched' };
    const response = buildResponse();
    const next: CallHandler = { handle: () => of('ok') };
    const addSpy = jest.spyOn(meters.httpRequestsTotal, 'add');

    interceptor.intercept(buildContext(request, response), next).subscribe();
    response.triggerFinish();

    expect(addSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ route: '/unmatched' }),
    );
  });

  it('passes through the handler result unchanged', () => {
    const interceptor = new HttpObservabilityInterceptor();
    const request = {
      method: 'GET',
      path: '/routines',
      route: { path: '/routines' },
    };
    const response = buildResponse();
    const next: CallHandler = { handle: () => of('payload') };

    const result$ = interceptor.intercept(
      buildContext(request, response),
      next,
    );
    const values: unknown[] = [];
    result$.subscribe((value) => values.push(value));

    expect(values).toEqual(['payload']);
  });
});
