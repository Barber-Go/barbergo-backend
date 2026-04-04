import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CommissionsModule } from './commissions/commissions.module';
import { BarbersModule } from './barbers/barbers.module';
import { AvailabilityModule } from './availability/availability.module';
import { BookingsModule } from './bookings/bookings.module';
import { ReviewsModule } from './reviews/reviews.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { BarbershopsModule } from './barbershops/barbershops.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { FinancesModule } from './finances/finances.module';
import { CommunitiesModule } from './communities/communities.module';
import { FollowsModule } from './follows/follows.module';
import { SettingsModule } from './settings/settings.module';
import { PaymentsModule } from './payments/payments.module';
import { StorageModule } from './storage/storage.module';
import { SiiModule } from './sii/sii.module';
import { PushModule } from './push/push.module';
import { ChatModule } from './chat/chat.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    StorageModule,
    PushModule,
    AuthModule,
    CommissionsModule,
    BarbersModule,
    AvailabilityModule,
    BookingsModule,
    ReviewsModule,
    NotificationsModule,
    DiscoveryModule,
    BarbershopsModule,
    PortfolioModule,
    FinancesModule,
    CommunitiesModule,
    FollowsModule,
    SettingsModule,
    PaymentsModule,
    SiiModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
