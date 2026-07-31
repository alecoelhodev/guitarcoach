import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { ROUTINE_CREATED_PATTERN } from './routine-created.event';
import type { RoutineCreatedEvent } from './routine-created.event';

@Controller()
export class RoutineCreatedConsumer {
  private readonly logger = new Logger(RoutineCreatedConsumer.name);

  @EventPattern(ROUTINE_CREATED_PATTERN)
  handleRoutineCreated(@Payload() event: RoutineCreatedEvent): void {
    this.logger.log('routine.created event received', event);
  }
}
