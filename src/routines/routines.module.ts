import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { EnvironmentVariables } from '../config/env.validation';
import {
  ROUTINE_EVENTS_CLIENT,
  routineEventsRmqOptions,
} from './events/rabbitmq.constants';
import { RoutineCreatedConsumer } from './events/routine-created.consumer';
import { RoutineCreatedProducer } from './events/routine-created.producer';
import { RoutinesController } from './routines.controller';
import { RoutinesService } from './routines.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: ROUTINE_EVENTS_CLIENT,
        inject: [ConfigService],
        useFactory: (
          configService: ConfigService<EnvironmentVariables, true>,
        ) =>
          routineEventsRmqOptions(
            configService.get('RABBITMQ_URL', { infer: true }),
          ),
      },
    ]),
  ],
  controllers: [RoutinesController, RoutineCreatedConsumer],
  providers: [RoutinesService, RoutineCreatedProducer],
  exports: [RoutinesService],
})
export class RoutinesModule {}
