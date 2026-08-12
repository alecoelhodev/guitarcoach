import { RequestContext } from './request-context';

describe('RequestContext', () => {
  it('returns undefined outside of a run() scope', () => {
    expect(RequestContext.get()).toBeUndefined();
    expect(RequestContext.getRequestId()).toBeUndefined();
  });

  it('exposes the data passed to run() inside its callback', () => {
    RequestContext.run({ requestId: 'req-1', correlationId: 'corr-1' }, () => {
      expect(RequestContext.getRequestId()).toBe('req-1');
      expect(RequestContext.getCorrelationId()).toBe('corr-1');
    });
  });

  it('propagates context across async boundaries within the same run()', async () => {
    await RequestContext.run(
      { requestId: 'req-async', correlationId: 'corr-async' },
      async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(RequestContext.getRequestId()).toBe('req-async');
      },
    );
  });

  it('isolates concurrent run() scopes from each other', async () => {
    const results = await Promise.all([
      RequestContext.run({ requestId: 'a', correlationId: 'a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return RequestContext.getRequestId();
      }),
      RequestContext.run({ requestId: 'b', correlationId: 'b' }, () => {
        return Promise.resolve(RequestContext.getRequestId());
      }),
    ]);

    expect(results).toEqual(['a', 'b']);
  });
});
