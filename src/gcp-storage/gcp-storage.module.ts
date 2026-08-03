import { Global, Module } from '@nestjs/common';
import { GcpStorageService } from './gcp-storage.service';

@Global()
@Module({
  providers: [GcpStorageService],
  exports: [GcpStorageService],
})
export class GcpStorageModule {}
