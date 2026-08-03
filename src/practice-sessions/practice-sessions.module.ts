import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { EnvironmentVariables } from '../config/env.validation';
import { PracticeSessionsController } from './practice-sessions.controller';
import { PracticeSessionsService } from './practice-sessions.service';
import { recordingFileFilter } from './recordings/recording-file-filter';
import { RecordingsController } from './recordings/recordings.controller';
import { RecordingsService } from './recordings/recordings.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: configService.get('RECORDING_UPLOAD_MAX_SIZE_BYTES', {
            infer: true,
          }),
        },
        fileFilter: recordingFileFilter,
      }),
    }),
  ],
  controllers: [PracticeSessionsController, RecordingsController],
  providers: [PracticeSessionsService, RecordingsService],
})
export class PracticeSessionsModule {}
