import { metrics } from '@opentelemetry/api';

/**
 * Every OTel instrument used across the app, defined once so parallel
 * instrumentation work doesn't invent conflicting metric names/units. Callers
 * always record against these unconditionally — `@opentelemetry/api` returns
 * a harmless no-op meter until `MetricsModule` registers a real
 * `MeterProvider` (gated by `METRICS_EXPORT_ENABLED`), so no call site needs
 * to check whether metrics export is enabled.
 *
 * Keep attribute sets low-cardinality (route templates, model/action names,
 * queue/job/tool names, coarse outcome strings) — never raw user IDs, request
 * IDs, full URLs, or error messages as attributes.
 */
const meter = metrics.getMeter('guitar-coach-api');

export const meters = {
  httpRequestsTotal: meter.createCounter('http_requests_total', {
    description:
      'HTTP requests handled, labeled by route template, method, and status code.',
  }),
  httpRequestDurationMs: meter.createHistogram('http_request_duration_ms', {
    description: 'HTTP request duration.',
    unit: 'ms',
  }),

  dbQueryDurationMs: meter.createHistogram('db_query_duration_ms', {
    description: 'Prisma query duration, labeled by model and action only.',
    unit: 'ms',
  }),

  queueMessagesPublishedTotal: meter.createCounter(
    'queue_messages_published_total',
    { description: 'RabbitMQ messages published, labeled by event type.' },
  ),
  queueMessagesConsumedTotal: meter.createCounter(
    'queue_messages_consumed_total',
    {
      description:
        'RabbitMQ messages successfully consumed, labeled by event type.',
    },
  ),
  queueConsumerFailuresTotal: meter.createCounter(
    'queue_consumer_failures_total',
    {
      description: 'RabbitMQ consumer handler failures, labeled by event type.',
    },
  ),
  queueDeadLetteredTotal: meter.createCounter('queue_dead_lettered_total', {
    description: 'RabbitMQ messages routed to the dead-letter queue.',
  }),

  jobRunsTotal: meter.createCounter('job_runs_total', {
    description:
      'Scheduled/background job runs, labeled by job name and outcome.',
  }),
  jobDurationMs: meter.createHistogram('job_duration_ms', {
    description: 'Scheduled/background job duration, labeled by job name.',
    unit: 'ms',
  }),

  aiRequestsTotal: meter.createCounter('ai_requests_total', {
    description:
      'AI provider/agent requests, labeled by provider/agent name and outcome.',
  }),
  aiRequestDurationMs: meter.createHistogram('ai_request_duration_ms', {
    description:
      'AI provider/agent request duration, labeled by provider/agent name.',
    unit: 'ms',
  }),
  aiToolDurationMs: meter.createHistogram('ai_tool_duration_ms', {
    description:
      'AI agent tool-call duration, labeled by tool name and outcome.',
    unit: 'ms',
  }),
  aiTokensTotal: meter.createCounter('ai_tokens_total', {
    description:
      'AI token usage, labeled by provider/agent name and token kind.',
  }),
  aiGuardrailTriggersTotal: meter.createCounter('ai_guardrail_triggers_total', {
    description: 'AI input guardrail trips.',
  }),
  aiMaxTurnsTotal: meter.createCounter('ai_max_turns_total', {
    description: 'AI agent runs terminated by hitting the max-turns limit.',
  }),

  redisOperationFailuresTotal: meter.createCounter(
    'redis_operation_failures_total',
    {
      description: 'Redis operation failures, labeled by client and operation.',
    },
  ),
  rateLimitDeniedTotal: meter.createCounter('rate_limit_denied_total', {
    description: 'Requests denied by the Redis-backed auth rate limiter.',
  }),
};
