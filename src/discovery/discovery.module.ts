import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { ExternalBarbersService } from './external-barbers.service';

@Module({
  controllers: [DiscoveryController],
  providers: [DiscoveryService, ExternalBarbersService],
})
export class DiscoveryModule {}
