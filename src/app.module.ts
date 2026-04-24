import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
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
import { AiStyleModule } from './ai-style/ai-style.module';
import { TaxComplianceModule } from './tax-compliance/tax-compliance.module';
import { BillingModule } from './billing/billing.module';
import { PointsModule } from './points/points.module';
import { ManualBookingsModule } from './manual-bookings/manual-bookings.module';
import { BarberEmployeeModule } from './barber-employee/barber-employee.module';
import { CreditsModule } from './credits/credits.module';
import { CancellationsModule } from './cancellations/cancellations.module';
import { TipsModule } from './tips/tips.module';
import { ReportsModule } from './reports/reports.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
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
    AiStyleModule,
    TaxComplianceModule,
    BillingModule,
    PointsModule,
    ManualBookingsModule,
    BarberEmployeeModule,
    CreditsModule,
    CancellationsModule,
    TipsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    AppService,
  ],
})
export class AppModule {}
