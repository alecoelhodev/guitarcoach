import { Logger } from '@nestjs/common';
import { SecurityEventLogger } from './security-event.logger';

describe('SecurityEventLogger', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs a success outcome at "log" level under the shared security-event schema', () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    new SecurityEventLogger().log({
      eventType: 'auth.sign_in',
      outcome: 'success',
      actorId: 'user-1',
    });

    expect(logSpy).toHaveBeenCalledWith(
      'auth.sign_in',
      expect.objectContaining({
        eventCategory: 'security',
        outcome: 'success',
        actorId: 'user-1',
      }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each(['failure', 'denied', 'triggered'] as const)(
    'logs a %s outcome at "warn" level',
    (outcome) => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      new SecurityEventLogger().log({
        eventType: 'rate_limit.denied',
        outcome,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        'rate_limit.denied',
        expect.objectContaining({ eventCategory: 'security', outcome }),
      );
    },
  );

  it('never includes PII beyond the minimum identifier fields', () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    new SecurityEventLogger().log({
      eventType: 'ai.guardrail_triggered',
      outcome: 'triggered',
      detail: { matchedDenyTerm: 'ignore instructions' },
    });

    const [, meta] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta).not.toHaveProperty('email');
    expect(meta.matchedDenyTerm).toBe('ignore instructions');
  });
});
