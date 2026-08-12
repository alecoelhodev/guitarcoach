import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { SecurityEventLogger } from './security-event.logger';

type MockRequest = {
  method: string;
  path: string;
  route?: { path: string };
  user?: { id: string };
};

type MockResponse = { status: jest.Mock; json: jest.Mock };

function buildHost(
  request: MockRequest,
  response: MockResponse,
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

function buildResponse(): MockResponse {
  const response: Partial<MockResponse> = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response as MockResponse;
}

describe('HttpExceptionFilter', () => {
  let securityEvents: { log: jest.Mock };
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    securityEvents = { log: jest.fn() };
    filter = new HttpExceptionFilter(
      securityEvents as unknown as SecurityEventLogger,
    );
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('normalizes a known HttpException into {statusCode, code, message, requestId}', () => {
    const request: MockRequest = {
      method: 'GET',
      path: '/routines/123',
      route: { path: '/routines/:id' },
    };
    const response = buildResponse();

    filter.catch(
      new NotFoundException('Routine not found'),
      buildHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Routine not found',
      requestId: undefined,
    });
  });

  it('never leaks the underlying message/stack for an unknown or 5xx error', () => {
    const request: MockRequest = { method: 'GET', path: '/routines' };
    const response = buildResponse();

    filter.catch(
      new Error('Prisma: connection string exposed in this message'),
      buildHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(500);
    const [body] = response.json.mock.calls[0] as [Record<string, unknown>];
    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: undefined,
    });
  });

  it('joins class-validator array messages into a single client-facing string', () => {
    const request: MockRequest = {
      method: 'POST',
      path: '/tasks',
      route: { path: '/tasks' },
    };
    const response = buildResponse();
    const exception = new BadRequestException({
      statusCode: 400,
      message: ['title must not be empty', 'category must be valid'],
      error: 'Bad Request',
    });

    filter.catch(exception, buildHost(request, response));

    const [body] = response.json.mock.calls[0] as [
      { message: string; code: string },
    ];
    expect(body.message).toBe(
      'title must not be empty; category must be valid',
    );
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('logs a security event for 401 responses, including the actor when available', () => {
    const request: MockRequest = {
      method: 'GET',
      path: '/routines',
      route: { path: '/routines' },
      user: { id: 'user-1' },
    };
    const response = buildResponse();

    filter.catch(new UnauthorizedException(), buildHost(request, response));

    expect(securityEvents.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'http.unauthorized',
        outcome: 'failure',
        actorId: 'user-1',
        targetId: '/routines',
      }),
    );
  });

  it('logs a security event for 403 responses', () => {
    const request: MockRequest = {
      method: 'POST',
      path: '/admin/promote',
      route: { path: '/admin/promote' },
    };
    const response = buildResponse();

    filter.catch(new ForbiddenException(), buildHost(request, response));

    expect(securityEvents.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'http.forbidden',
        outcome: 'failure',
      }),
    );
  });

  it('does not log a security event for an ordinary 404', () => {
    const request: MockRequest = {
      method: 'GET',
      path: '/routines/x',
      route: { path: '/routines/:id' },
    };
    const response = buildResponse();

    filter.catch(new NotFoundException(), buildHost(request, response));

    expect(securityEvents.log).not.toHaveBeenCalled();
  });
});
