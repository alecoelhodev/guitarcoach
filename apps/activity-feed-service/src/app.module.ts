import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityFeedModule } from './activity-feed/activity-feed.module';
import { EnvironmentVariables, validate } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ) => ({
        uri: configService.get('MONGODB_URL', { infer: true }),
      }),
    }),
    ActivityFeedModule,
  ],
})
export class AppModule {}
