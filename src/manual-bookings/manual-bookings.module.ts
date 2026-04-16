import { Module } from '@nestjs/common';
import { ManualBookingsController } from './manual-bookings.controller';
import { ManualBookingsService } from './manual-bookings.service';

@Module({
  controllers: [ManualBookingsController],
  providers: [ManualBookingsService],
  exports: [ManualBookingsService],
})
export class ManualBookingsModule {}
