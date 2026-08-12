import { Injectable, Logger } from '@nestjs/common';

export type SecurityEventOutcome =
  'success' | 'failure' | 'denied' | 'triggered';

export interface SecurityEventInput {
  /** Stable, filterable slug, e.g. 'auth.sign_in', 'rate_limit.denied', 'ai.guardrail_triggered'. */
  eventType: string;
  outcome: SecurityEventOutcome;
  /** Minimum identifier necessary — a user/session id, never an email or PII payload. */
  actorId?: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}

/**
 * Single choke point for OWASP-A09-relevant security events (auth
 * failures/successes, rate-limit denials, AI guardrail trips, admin/audit
 * actions), so they share one queryable schema (`eventCategory: 'security'`)
 * distinct from ordinary application/debug logs. Backed by the structured
 * logger set via `app.useLogger(...)`, so requestId/correlationId/timestamp
 * are attached automatically — callers never need to pass them.
 */
@Injectable()
export class SecurityEventLogger {
  private readonly logger = new Logger('SecurityEvent');

  log(input: SecurityEventInput): void {
    const level = input.outcome === 'success' ? 'log' : 'warn';
    this.logger[level](input.eventType, {
      eventCategory: 'security',
      outcome: input.outcome,
      actorId: input.actorId,
      targetType: input.targetType,
      targetId: input.targetId,
      ...input.detail,
    });
  }
}
