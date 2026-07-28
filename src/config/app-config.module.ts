import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      expandVariables: true,
      validate,
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
