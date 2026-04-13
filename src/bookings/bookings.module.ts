import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { ChatModule } from '../chat/chat.module';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [NotificationsModule, CommissionsModule, ChatModule, PointsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
