import { Request, Response } from 'express';
import { correlationIdMiddleware } from './correlation-id.middleware';
import { RequestContext } from './request-context';

function buildRequest(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function buildResponse(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    _headers: headers,
  } as unknown as Response & { _headers: Record<string, string> };
}

describe('correlationIdMiddleware', () => {
  it('generates a request ID when none is provided and returns it on the response', () => {
    const req = buildRequest();
    const res = buildResponse();
    let capturedRequestId: string | undefined;

    correlationIdMiddleware(req, res, () => {
      capturedRequestId = RequestContext.getRequestId();
    });

    expect(res._headers['x-request-id']).toBeDefined();
    expect(capturedRequestId).toBe(res._headers['x-request-id']);
  });

  it('accepts a well-formed incoming x-request-id header', () => {
    const req = buildRequest({ 'x-request-id': 'client-supplied-id-123' });
    const res = buildResponse();

    correlationIdMiddleware(req, res, () => {});

    expect(res._headers['x-request-id']).toBe('client-supplied-id-123');
  });

  it('rejects a malformed/unsafe incoming x-request-id and generates one instead', () => {
    const req = buildRequest({ 'x-request-id': 'not safe!\ninjected' });
    const res = buildResponse();

    correlationIdMiddleware(req, res, () => {});

    expect(res._headers['x-request-id']).not.toBe('not safe!\ninjected');
    expect(res._headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('sets correlationId equal to requestId at the HTTP boundary', () => {
    const req = buildRequest();
    const res = buildResponse();
    let captured: { requestId?: string; correlationId?: string } = {};

    correlationIdMiddleware(req, res, () => {
      captured = {
        requestId: RequestContext.getRequestId(),
        correlationId: RequestContext.getCorrelationId(),
      };
    });

    expect(captured.requestId).toBe(captured.correlationId);
  });

  it('calls next() so the request pipeline continues', () => {
    const req = buildRequest();
    const res = buildResponse();
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
