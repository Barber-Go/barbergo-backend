import { Module } from '@nestjs/common';
import { SiiController } from './sii.controller';
import { SiiService } from './sii.service';

@Module({
  controllers: [SiiController],
  providers: [SiiService],
  exports: [SiiService],
})
export class SiiModule {}
