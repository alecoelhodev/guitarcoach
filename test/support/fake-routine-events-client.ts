import { Injectable } from '@nestjs/common';
import { Observable, of } from 'rxjs';

/**
 * In-memory stand-in for the RabbitMQ ClientProxy injected as
 * ROUTINE_EVENTS_CLIENT, swapped in via overrideProvider in buildTestApp so
 * e2e specs never open a real AMQP connection. RoutineCreatedProducer only
 * calls emit() and subscribes to the result, so that's all this needs to
 * implement.
 */
@Injectable()
export class FakeRoutineEventsClient {
  readonly emitted: { pattern: string; data: unknown }[] = [];

  emit<T = unknown>(pattern: string, data: T): Observable<T> {
    this.emitted.push({ pattern, data });
    return of(data);
  }
}
