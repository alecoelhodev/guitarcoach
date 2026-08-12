import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  /** Unique to this hop (this HTTP request, or this message-consumption attempt). */
  requestId: string;
  /** Constant across the whole logical operation (HTTP -> queue -> worker -> AI call). */
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/**
 * Ambient request/correlation context, readable from anywhere (logger, services,
 * RabbitMQ producer/consumer, AI instrumentation) without threading an ID through
 * every method signature. Populated once per hop via `run()` — HTTP requests via
 * `CorrelationIdMiddleware`, the RabbitMQ consumer, and the weekly cleanup job's
 * `main.ts` each call this directly.
 */
export const RequestContext = {
  run<T>(data: RequestContextData, callback: () => T): T {
    return storage.run(data, callback);
  },

  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  getCorrelationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },
};
