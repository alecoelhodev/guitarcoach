import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { EnvironmentVariables } from '../../config/env.validation';
import { MetricsModule } from './metrics.module';

type MockConfigService = { get: jest.Mock };

function buildConfigService(
  overrides: Partial<Record<string, unknown>> = {},
): MockConfigService {
  const values: Record<string, unknown> = {
    METRICS_EXPORT_ENABLED: false,
    GCP_PROJECT_ID: 'guitar-coach-dev',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

describe('MetricsModule', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs that export is disabled and never touches GoogleAuth when METRICS_EXPORT_ENABLED is false', () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const authSpy = jest.spyOn(GoogleAuth.prototype, 'getClient');
    const configService = buildConfigService({ METRICS_EXPORT_ENABLED: false });

    const module = new MetricsModule(
      configService as unknown as ConfigService<EnvironmentVariables, true>,
    );
    module.onModuleInit();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    expect(authSpy).not.toHaveBeenCalled();
  });

  it('fails open (logs, never throws) when the exporter cannot be initialized', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest
      .spyOn(GoogleAuth.prototype, 'getClient')
      .mockRejectedValue(
        new Error('no credentials available in this environment'),
      );
    const configService = buildConfigService({ METRICS_EXPORT_ENABLED: true });

    const module = new MetricsModule(
      configService as unknown as ConfigService<EnvironmentVariables, true>,
    );

    expect(() => module.onModuleInit()).not.toThrow();

    // onModuleInit fires the exporter setup without awaiting it (fail-open,
    // never blocks bootstrap) — flush the microtask queue to observe the
    // rejection being caught rather than propagating.
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to initialize'),
      expect.any(Error),
    );
  });
});
