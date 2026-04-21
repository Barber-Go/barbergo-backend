import { Module } from '@nestjs/common';
import { CancellationsController } from './cancellations.controller';
import { CancellationsService } from './cancellations.service';
import { CreditsModule } from '../credits/credits.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CreditsModule, NotificationsModule],
  controllers: [CancellationsController],
  providers: [CancellationsService],
  exports: [CancellationsService],
})
export class CancellationsModule {}
