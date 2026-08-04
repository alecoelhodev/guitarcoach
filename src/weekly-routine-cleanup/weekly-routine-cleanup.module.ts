import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { validate } from './env.validation';
import { WeeklyRoutineCleanupService } from './weekly-routine-cleanup.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      expandVariables: true,
      validate,
    }),
    PrismaModule,
  ],
  providers: [WeeklyRoutineCleanupService],
})
export class WeeklyRoutineCleanupModule {}
