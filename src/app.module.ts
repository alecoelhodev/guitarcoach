import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [AppConfigModule, HealthModule, UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
