import { Inject, Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { GoogleAuth } from 'google-auth-library';
import { EnvironmentVariables } from '../../config/env.validation';

// GCP's own GoogleCloudPlatform/opentelemetry-operations-js MIGRATION.md
// deprecated the dedicated `@google-cloud/opentelemetry-cloud-monitoring-exporter`
// package in favor of Cloud Monitoring's native OTLP ingestion endpoint —
// hence a plain OTLP exporter here instead of a GCP-specific one.
const CLOUD_MONITORING_OTLP_METRICS_ENDPOINT =
  'https://telemetry.googleapis.com/v1/metrics';
const EXPORT_INTERVAL_MS = 60_000;
const AUTH_SCOPES = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * Registers the real OTel `MeterProvider` + GCP Cloud Monitoring OTLP
 * exporter when `METRICS_EXPORT_ENABLED=true` (production only — local/dev/
 * test never attempt to authenticate against GCP). Until that's enabled (or
 * if it fails), `@opentelemetry/api`'s default global meter provider is a
 * documented no-op, so every instrument in `meters.ts` is already safe to
 * call unconditionally.
 *
 * Requires the runtime's service account to have `roles/monitoring.metricWriter`
 * and the `monitoring.googleapis.com` API enabled on the GCP project — both
 * one-off `gcloud` grants, provisioned the same way every other piece of GCP
 * infra in this repo is (see README's Continuous deployment section) rather
 * than via Terraform/IaC, which doesn't exist yet for this project.
 */
@Module({})
export class MetricsModule implements OnModuleInit {
  private readonly logger = new Logger(MetricsModule.name);

  // Explicit @Inject(): esbuild (used by `tsx`, e.g. the weekly-cleanup job's
  // standalone entrypoint) doesn't reliably emit constructor decorator
  // metadata once a parameter has a generic-instantiated type like
  // `ConfigService<T, true>` — see the same note in
  // weekly-routine-cleanup.service.ts. Without this, DI silently resolves
  // `configService` to `undefined` under tsx while working fine under
  // `nest build`/ts-jest, which is exactly the failure mode this guards
  // against for any tsx-bootstrapped module importing ObservabilityModule.
  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get('METRICS_EXPORT_ENABLED', {
      infer: true,
    });

    if (!enabled) {
      this.logger.log(
        'Metrics export disabled; instruments record against a no-op meter',
      );
      return;
    }

    // Fail open: a broken metrics pipeline (bad credentials, network outage,
    // missing IAM grant) must never crash the app, matching the repo's
    // existing Redis-fail-open convention.
    this.registerExporter().catch((error: unknown) => {
      this.logger.error(
        'Failed to initialize GCP Cloud Monitoring metrics export; continuing without it',
        error,
      );
    });
  }

  private async registerExporter(): Promise<void> {
    const projectId = this.configService.get('GCP_PROJECT_ID', {
      infer: true,
    });

    const auth = new GoogleAuth({ scopes: AUTH_SCOPES });
    const authClient = await auth.getClient();

    const exporter = new OTLPMetricExporter({
      url: CLOUD_MONITORING_OTLP_METRICS_ENDPOINT,
      // google-auth-library's `Headers` is already a plain Record<string,
      // string> (not the Fetch API's Headers class) — no .entries() needed.
      headers: () => authClient.getRequestHeaders(),
    });

    const meterProvider = new MeterProvider({
      resource: resourceFromAttributes({
        'service.name': 'guitar-coach-api',
        'gcp.project_id': projectId,
      }),
      readers: [
        new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: EXPORT_INTERVAL_MS,
        }),
      ],
    });

    metrics.setGlobalMeterProvider(meterProvider);
    this.logger.log('GCP Cloud Monitoring metrics export enabled');
  }
}
