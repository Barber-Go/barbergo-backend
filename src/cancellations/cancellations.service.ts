import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CancellerRole,
  CancellationReason,
  Role,
  SuspensionLevel,
} from '../generated/prisma/enums';

// ── Reason labels ─────────────────────────────────────────────────────────────

const CLIENT_REASONS: { code: CancellationReason; label: string }[] = [
  { code: 'CLIENT_CANT_ATTEND', label: 'No puedo asistir' },
  { code: 'CLIENT_WRONG_TIME', label: 'Me equivoqué de hora' },
  { code: 'CLIENT_CHANGED_MIND', label: 'Cambio de planes' },
  { code: 'CLIENT_EMERGENCY', label: 'Emergencia personal' },
  { code: 'CLIENT_OTHER', label: 'Otro motivo' },
];

const PROVIDER_REASONS: { code: CancellationReason; label: string }[] = [
  { code: 'PROVIDER_ILLNESS', label: 'Enfermedad' },
  { code: 'PROVIDER_PERSONAL_ISSUE', label: 'Imprevisto personal' },
  { code: 'PROVIDER_LOCAL_ISSUE', label: 'Problema con el local' },
  { code: 'PROVIDER_EQUIPMENT', label: 'Problema con equipamiento' },
  { code: 'PROVIDER_OVERBOOKING', label: 'Error de doble reserva' },
  { code: 'PROVIDER_OTHER', label: 'Otro motivo' },
];

interface CancelPolicy {
  code: string;
  refundAmount: number;
  bonusAmount: number;
}

@Injectable()
export class CancellationsService {
  private readonly logger = new Logger(CancellationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Cancel a booking ────────────────────────────────────────────────────────

  async cancelBooking(
    bookingId: string,
    userId: string,
    userRole: Role,
    reason: CancellationReason,
    notes?: string,
  ) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, deletedAt: null },
      include: {
        barber: { select: { userId: true, barbershopId: true, employmentType: true } },
        service: { select: { name: true } },
      },
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      throw new BadRequestException('La reserva ya no se puede cancelar');
    }

    const cancellerRole = this.determineCancellerRole(booking, userId, userRole);
    const grossAmount = Number(booking.grossAmount);

    // Block client-initiated cancellations inside the 24h window when the
    // booking was paid in-app. Contacting the barber avoids the dispute.
    // CASH bookings stay cancellable (no money to refund anyway).
    // Providers can always cancel; penalties are tracked via suspensions.
    const hoursUntil = (booking.scheduledAt.getTime() - Date.now()) / 3600000;
    if (cancellerRole === 'CLIENT' && hoursUntil < 24 && booking.paymentMethod === 'IN_APP') {
      throw new BadRequestException(
        'No se puede cancelar una reserva pagada con menos de 24 horas de anticipación. ' +
        'Contacta al barbero para coordinar.',
      );
    }

    const policy = this.calculatePolicy(grossAmount, booking.scheduledAt, booking.paymentMethod, cancellerRole);

    // All booking mutation + credit grants + cancellation record in a single
    // transaction so we never leave the system in a partial state.
    const result = await this.prisma.client.$transaction(
      async (tx) => {
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledByUserId: userId,
            cancelledByRole: cancellerRole,
            cancellationReason: reason,
            cancellationNotes: notes ?? null,
            refundAmount: policy.refundAmount,
            compensationBonusAmount: policy.bonusAmount,
          },
        });

        let refundTxId: string | null = null;
        let bonusTxId: string | null = null;

        if (policy.refundAmount > 0) {
          const refundTx = await this.creditsService.createRefund(
            {
              userId: booking.clientId,
              amount: policy.refundAmount,
              bookingId: booking.id,
              description: 'Reembolso por cancelación de reserva',
            },
            tx,
          );
          refundTxId = refundTx.id;
        }

        if (policy.bonusAmount > 0) {
          const bonusTx = await this.creditsService.createBonus(
            {
              userId: booking.clientId,
              amount: policy.bonusAmount,
              bookingId: booking.id,
              description: 'Bono de compensación por cancelación del proveedor',
            },
            tx,
          );
          bonusTxId = bonusTx.id;
        }

        if (refundTxId || bonusTxId) {
          await tx.booking.update({
            where: { id: bookingId },
            data: {
              refundTransactionId: refundTxId,
              compensationBonusTxId: bonusTxId,
            },
          });
        }

        if (cancellerRole !== 'CLIENT') {
          const providerRole = booking.barber.employmentType === 'EMPLOYEE'
            ? 'BARBER_EMPLOYEE' as const
            : 'BARBER_INDEPENDENT' as const;

          await tx.cancellationRecord.create({
            data: {
              providerUserId: booking.barber.userId,
              providerRole,
              barbershopId: booking.barbershopId ?? null,
              bookingId: booking.id,
              reason,
              notes: notes ?? null,
              refundAmount: policy.refundAmount,
              compensationBonus: policy.bonusAmount,
            },
          });
        }

        return { refundTxId, bonusTxId };
      },
      { timeout: 10000 },
    );

    // Post-commit side effects (safe to be fire-and-forget)
    if (cancellerRole !== 'CLIENT') {
      this.updateCancellationRate(booking.barber.userId, booking.barbershopId).catch(() => {});
      this.evaluatePenalties(booking.barber.userId, booking.barbershopId).catch(() => {});
    }
    this.sendCancellationNotifications(booking, cancellerRole, policy).catch(() => {});

    return {
      booking: {
        id: booking.id,
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledByRole: cancellerRole,
        cancellationReason: reason,
      },
      refund: {
        amount: policy.refundAmount,
        bonus: policy.bonusAmount,
        totalToCredits: policy.refundAmount + policy.bonusAmount,
        refundTransactionId: result.refundTxId,
        bonusTransactionId: result.bonusTxId,
      },
      cancellerRole,
      policy: policy.code,
    };
  }

  // ── Cancellation policy preview ──────────────────────────────────────────

  async getCancellationPolicy(bookingId: string, userId: string, userRole: Role) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, deletedAt: null },
      include: {
        barber: { select: { userId: true, barbershopId: true } },
      },
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');

    const cancellerRole = this.determineCancellerRole(booking, userId, userRole);
    const grossAmount = Number(booking.grossAmount);
    const hoursUntil = (booking.scheduledAt.getTime() - Date.now()) / 3600000;
    const policy = this.calculatePolicy(grossAmount, booking.scheduledAt, booking.paymentMethod, cancellerRole);

    const statusCancellable = booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED';
    const blockedByWindow =
      cancellerRole === 'CLIENT' && hoursUntil < 24 && booking.paymentMethod === 'IN_APP';
    const canCancel = statusCancellable && !blockedByWindow;

    const isClient = cancellerRole === 'CLIENT';
    const availableReasons = isClient ? CLIENT_REASONS : PROVIDER_REASONS;

    return {
      canCancel,
      role: cancellerRole,
      hoursUntilBooking: Math.round(hoursUntil * 10) / 10,
      refundPolicy: {
        eligibleForRefund: policy.refundAmount > 0,
        refundAmount: policy.refundAmount,
        refundPercent: grossAmount > 0 ? Math.round((policy.refundAmount / grossAmount) * 100) : 0,
        bonusAmount: policy.bonusAmount,
        reason: isClient
          ? (hoursUntil >= 24 ? 'Más de 24 horas antes del corte' : 'Menos de 24 horas antes del corte')
          : 'Cancelación por proveedor — refund completo + bono',
      },
      availableReasons,
    };
  }

  // ── Provider cancellation stats ──────────────────────────────────���───────

  async getProviderStats(userId: string) {
    const barberProfile = await this.prisma.client.barberProfile.findUnique({
      where: { userId },
      select: {
        cancellationRate: true,
        cancellationCount30d: true,
        bookingsCount30d: true,
        isCurrentlySuspended: true,
        suspensionLevel: true,
        suspensionExpiresAt: true,
      },
    });

    if (!barberProfile) throw new NotFoundException('Perfil no encontrado');

    const rate = barberProfile.cancellationRate ?? 0;
    const badge = this.getBadge(rate, barberProfile.isCurrentlySuspended);

    // Last 3 months history
    const history = await this.getMonthlyHistory(userId);

    const currentSuspension = barberProfile.isCurrentlySuspended
      ? {
          level: barberProfile.suspensionLevel,
          expiresAt: barberProfile.suspensionExpiresAt,
        }
      : null;

    return {
      cancellationRate30d: Math.round(rate * 10) / 10,
      cancellationCount30d: barberProfile.cancellationCount30d,
      bookingsCount30d: barberProfile.bookingsCount30d,
      badge,
      currentSuspension,
      history,
    };
  }

  // ── Public stats (client sees) ───────────────────────────────────────────

  async getPublicStats(barberProfileId: string) {
    const profile = await this.prisma.client.barberProfile.findUnique({
      where: { id: barberProfileId },
      select: { cancellationRate: true, isCurrentlySuspended: true },
    });

    if (!profile) throw new NotFoundException('Barbero no encontrado');

    const rate = profile.cancellationRate ?? 0;
    const badge = this.getBadge(rate, profile.isCurrentlySuspended);

    return {
      acceptanceRate: Math.round((100 - rate) * 10) / 10,
      badge,
      showWarning: rate > 10,
    };
  }

  // ── Admin suspend/resolve ────────────────────────────────────────────────

  async adminSuspend(
    providerUserId: string,
    level: SuspensionLevel,
    reason: string,
    adminId: string,
  ) {
    const expiresAt = level === 'TEMPORARY_SUSPENSION'
      ? new Date(Date.now() + 7 * 24 * 3600000)
      : undefined;

    await this.prisma.client.providerSuspension.create({
      data: {
        providerUserId,
        level,
        triggerReason: reason,
        triggerMetrics: { source: 'admin', adminId },
        expiresAt,
      },
    });

    await this.prisma.client.barberProfile.updateMany({
      where: { userId: providerUserId },
      data: {
        isCurrentlySuspended: true,
        suspensionLevel: level,
        suspensionExpiresAt: expiresAt ?? null,
      },
    });

    this.notificationsService.create(
      providerUserId,
      'GENERAL',
      'Cuenta suspendida',
      `Tu cuenta fue suspendida por un administrador: ${reason}`,
    ).catch(() => {});

    return { success: true };
  }

  async adminResolve(suspensionId: string, adminId: string) {
    const suspension = await this.prisma.client.providerSuspension.findUnique({
      where: { id: suspensionId },
    });
    if (!suspension) throw new NotFoundException('Suspensión no encontrada');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.providerSuspension.update({
        where: { id: suspensionId },
        data: { isActive: false, resolvedAt: new Date(), resolvedByAdminId: adminId },
      });

      if (suspension.providerUserId) {
        // Check if there are other active suspensions
        const otherActive = await tx.providerSuspension.count({
          where: { providerUserId: suspension.providerUserId, isActive: true, id: { not: suspensionId } },
        });
        if (otherActive === 0) {
          await tx.barberProfile.updateMany({
            where: { userId: suspension.providerUserId },
            data: { isCurrentlySuspended: false, suspensionLevel: null, suspensionExpiresAt: null },
          });
        }
      }

      if (suspension.barbershopId) {
        const otherActive = await tx.providerSuspension.count({
          where: { barbershopId: suspension.barbershopId, isActive: true, id: { not: suspensionId } },
        });
        if (otherActive === 0) {
          await tx.barbershopProfile.update({
            where: { id: suspension.barbershopId },
            data: { isCurrentlySuspended: false, suspensionLevel: null, suspensionExpiresAt: null },
          });
        }
      }
    });

    if (suspension.providerUserId) {
      this.notificationsService.create(
        suspension.providerUserId,
        'GENERAL',
        'Suspensión levantada',
        'Tu cuenta ha sido reactivada. Ya apareces en búsquedas nuevamente.',
      ).catch(() => {});
    }

    return { success: true };
  }

  // ── Cron: auto-resolve expired suspensions ──────────────────────────────

  @Cron('0 2 * * *')
  async resolveExpiredSuspensions() {
    this.logger.log('Running suspension expiration cron');
    const now = new Date();

    const expired = await this.prisma.client.providerSuspension.findMany({
      where: { isActive: true, expiresAt: { lt: now }, level: 'TEMPORARY_SUSPENSION' },
    });

    for (const suspension of expired) {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.providerSuspension.update({
          where: { id: suspension.id },
          data: { isActive: false, resolvedAt: now },
        });

        if (suspension.providerUserId) {
          const otherActive = await tx.providerSuspension.count({
            where: { providerUserId: suspension.providerUserId, isActive: true, id: { not: suspension.id } },
          });
          if (otherActive === 0) {
            await tx.barberProfile.updateMany({
              where: { userId: suspension.providerUserId },
              data: { isCurrentlySuspended: false, suspensionLevel: null, suspensionExpiresAt: null },
            });
          }
        }

        if (suspension.barbershopId) {
          const otherActive = await tx.providerSuspension.count({
            where: { barbershopId: suspension.barbershopId, isActive: true, id: { not: suspension.id } },
          });
          if (otherActive === 0) {
            await tx.barbershopProfile.update({
              where: { id: suspension.barbershopId },
              data: { isCurrentlySuspended: false, suspensionLevel: null, suspensionExpiresAt: null },
            });
          }
        }
      });

      if (suspension.providerUserId) {
        this.notificationsService.create(
          suspension.providerUserId,
          'GENERAL',
          'Suspensión finalizada',
          'Tu suspensión temporal ha terminado. Ya apareces en búsquedas nuevamente.',
        ).catch(() => {});
      }
    }

    this.logger.log(`Resolved ${expired.length} expired suspensions`);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private determineCancellerRole(
    booking: { clientId: string; barber: { userId: string; barbershopId: string | null }; barbershopId: string | null },
    userId: string,
    userRole: Role,
  ): CancellerRole {
    if (userRole === 'ADMIN') return 'ADMIN';
    if (userId === booking.clientId) return 'CLIENT';

    // Check if user is the barber
    if (userId === booking.barber.userId) return 'BARBER';

    // Check if user is barbershop owner
    if (userRole === 'BARBERSHOP_OWNER') return 'BARBERSHOP';

    // Barber employees can cancel their own bookings
    if (userRole === 'BARBER_EMPLOYEE' && userId === booking.barber.userId) return 'BARBER';

    throw new ForbiddenException('No tienes permiso para cancelar esta reserva');
  }

  private calculatePolicy(
    grossAmount: number,
    scheduledAt: Date,
    paymentMethod: string,
    cancellerRole: CancellerRole,
  ): CancelPolicy {
    const hoursUntil = (scheduledAt.getTime() - Date.now()) / 3600000;
    const refundableAmount = paymentMethod === 'CASH' ? 0 : grossAmount;

    if (cancellerRole === 'CLIENT') {
      if (hoursUntil >= 24) {
        return { code: 'CLIENT_EARLY_FULL_REFUND', refundAmount: refundableAmount, bonusAmount: 0 };
      }
      return { code: 'CLIENT_LATE_NO_REFUND', refundAmount: 0, bonusAmount: 0 };
    }

    // BARBER, BARBERSHOP, ADMIN
    return {
      code: 'PROVIDER_CANCELLED_FULL_REFUND_PLUS_BONUS',
      refundAmount: refundableAmount,
      bonusAmount: 1000,
    };
  }

  private async updateCancellationRate(providerUserId: string, barbershopId: string | null) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const cancelCount = await this.prisma.client.cancellationRecord.count({
      where: { providerUserId, cancelledAt: { gte: thirtyDaysAgo }, deletedAt: null },
    });

    // Count all bookings for this provider in last 30 days
    const barberProfile = await this.prisma.client.barberProfile.findUnique({
      where: { userId: providerUserId },
      select: { id: true },
    });

    if (!barberProfile) return;

    const totalBookings = await this.prisma.client.booking.count({
      where: {
        barberId: barberProfile.id,
        scheduledAt: { gte: thirtyDaysAgo },
        deletedAt: null,
      },
    });

    const rate = totalBookings > 0 ? (cancelCount / totalBookings) * 100 : 0;

    await this.prisma.client.barberProfile.update({
      where: { id: barberProfile.id },
      data: {
        cancellationRate: rate,
        cancellationCount30d: cancelCount,
        bookingsCount30d: totalBookings,
      },
    });

    // Also update barbershop if applicable
    if (barbershopId) {
      const shopCancelCount = await this.prisma.client.cancellationRecord.count({
        where: { barbershopId, cancelledAt: { gte: thirtyDaysAgo }, deletedAt: null },
      });
      const shopBookings = await this.prisma.client.booking.count({
        where: { barbershopId, scheduledAt: { gte: thirtyDaysAgo }, deletedAt: null },
      });
      const shopRate = shopBookings > 0 ? (shopCancelCount / shopBookings) * 100 : 0;

      await this.prisma.client.barbershopProfile.update({
        where: { id: barbershopId },
        data: {
          cancellationRate: shopRate,
          cancellationCount30d: shopCancelCount,
          bookingsCount30d: shopBookings,
        },
      });
    }
  }

  private async evaluatePenalties(providerUserId: string, barbershopId: string | null) {
    const profile = await this.prisma.client.barberProfile.findUnique({
      where: { userId: providerUserId },
      select: { cancellationRate: true, isCurrentlySuspended: true },
    });
    if (!profile) return;

    const rate = profile.cancellationRate ?? 0;

    // If already suspended, don't stack
    if (profile.isCurrentlySuspended) return;

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Level 2: >10%
    if (rate > 10) {
      const recentSuspensions = await this.prisma.client.providerSuspension.count({
        where: {
          providerUserId,
          level: 'TEMPORARY_SUSPENSION',
          createdAt: { gte: sixMonthsAgo },
        },
      });

      if (recentSuspensions >= 2) {
        // Level 3: UNDER_REVIEW
        await this.applyLevel3(providerUserId, barbershopId, rate);
      } else {
        await this.applyLevel2(providerUserId, barbershopId, rate);
      }
      return;
    }

    // Level 1: >5%
    if (rate > 5) {
      // Check if warning already active
      const activeWarning = await this.prisma.client.providerSuspension.findFirst({
        where: { providerUserId, level: 'WARNING', isActive: true },
      });
      if (!activeWarning) {
        // Check if 3 months with warning → level 2
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const warningMonths = await this.prisma.client.providerSuspension.count({
          where: { providerUserId, level: 'WARNING', createdAt: { gte: threeMonthsAgo } },
        });

        if (warningMonths >= 3) {
          await this.applyLevel2(providerUserId, barbershopId, rate);
        } else {
          await this.applyLevel1(providerUserId, barbershopId, rate);
        }
      }
      return;
    }

    // Rate is good → auto-resolve active warnings
    await this.prisma.client.providerSuspension.updateMany({
      where: { providerUserId, level: 'WARNING', isActive: true },
      data: { isActive: false, resolvedAt: new Date() },
    });
  }

  private async applyLevel1(providerUserId: string, barbershopId: string | null, rate: number) {
    await this.prisma.client.providerSuspension.create({
      data: {
        providerUserId,
        barbershopId,
        level: 'WARNING',
        triggerReason: `Tasa de cancelación ${rate.toFixed(1)}% en últimos 30 días`,
        triggerMetrics: { rate, source: 'auto' },
      },
    });

    this.notificationsService.create(
      providerUserId,
      'GENERAL',
      'Advertencia: tasa de cancelación alta',
      `Tu tasa de cancelación es ${rate.toFixed(1)}%. Mantenerla sobre 5% afecta tu visibilidad en búsquedas.`,
    ).catch(() => {});
  }

  private async applyLevel2(providerUserId: string, barbershopId: string | null, rate: number) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.client.providerSuspension.create({
      data: {
        providerUserId,
        barbershopId,
        level: 'TEMPORARY_SUSPENSION',
        triggerReason: `Tasa de cancelación ${rate.toFixed(1)}% en últimos 30 días`,
        triggerMetrics: { rate, source: 'auto' },
        expiresAt,
      },
    });

    await this.prisma.client.barberProfile.updateMany({
      where: { userId: providerUserId },
      data: { isCurrentlySuspended: true, suspensionLevel: 'TEMPORARY_SUSPENSION', suspensionExpiresAt: expiresAt },
    });

    if (barbershopId) {
      await this.prisma.client.barbershopProfile.update({
        where: { id: barbershopId },
        data: { isCurrentlySuspended: true, suspensionLevel: 'TEMPORARY_SUSPENSION', suspensionExpiresAt: expiresAt },
      });
    }

    this.notificationsService.create(
      providerUserId,
      'GENERAL',
      'Cuenta suspendida 7 días',
      `Por tasa de cancelación alta (${rate.toFixed(1)}%). Se reactiva el ${expiresAt.toLocaleDateString('es-CL')}.`,
    ).catch(() => {});
  }

  private async applyLevel3(providerUserId: string, barbershopId: string | null, rate: number) {
    await this.prisma.client.providerSuspension.create({
      data: {
        providerUserId,
        barbershopId,
        level: 'UNDER_REVIEW',
        triggerReason: `3ra suspensión en 6 meses. Tasa actual: ${rate.toFixed(1)}%`,
        triggerMetrics: { rate, source: 'auto' },
      },
    });

    await this.prisma.client.barberProfile.updateMany({
      where: { userId: providerUserId },
      data: { isCurrentlySuspended: true, suspensionLevel: 'UNDER_REVIEW', suspensionExpiresAt: null },
    });

    if (barbershopId) {
      await this.prisma.client.barbershopProfile.update({
        where: { id: barbershopId },
        data: { isCurrentlySuspended: true, suspensionLevel: 'UNDER_REVIEW', suspensionExpiresAt: null },
      });
    }

    this.notificationsService.create(
      providerUserId,
      'GENERAL',
      'Cuenta en revisión',
      'Tu cuenta ha sido pausada indefinidamente por cancelaciones reiteradas. Un administrador revisará tu caso.',
    ).catch(() => {});
  }

  private async sendCancellationNotifications(
    booking: { id: string; clientId: string; barber: { userId: string }; service: { name: string } },
    cancellerRole: CancellerRole,
    policy: CancelPolicy,
  ) {
    const serviceName = booking.service.name;

    if (cancellerRole === 'CLIENT') {
      // Notify barber
      await this.notificationsService.create(
        booking.barber.userId,
        'BOOKING_CANCELLED',
        'Reserva cancelada por el cliente',
        `El cliente canceló su reserva de ${serviceName}.`,
      );
    } else {
      // Notify client
      const refundMsg = policy.refundAmount > 0
        ? ` Se acreditaron $${policy.refundAmount.toLocaleString('es-CL')} a tu wallet.`
        : '';
      const bonusMsg = policy.bonusAmount > 0
        ? ` Además recibiste $${policy.bonusAmount.toLocaleString('es-CL')} de compensación.`
        : '';
      await this.notificationsService.create(
        booking.clientId,
        'BOOKING_CANCELLED',
        'Tu reserva fue cancelada',
        `Tu reserva de ${serviceName} fue cancelada por el proveedor.${refundMsg}${bonusMsg}`,
      );

      // Notify barber of their own cancellation
      await this.notificationsService.create(
        booking.barber.userId,
        'BOOKING_CANCELLED',
        'Has cancelado una reserva',
        `Cancelaste la reserva de ${serviceName}. Esto afecta tu tasa de cancelación.`,
      );
    }
  }

  private getBadge(rate: number, isSuspended: boolean): string {
    if (isSuspended) return 'SUSPENDED';
    if (rate < 3) return 'RELIABLE';
    if (rate <= 10) return 'NEUTRAL';
    return 'WARNING';
  }

  private async getMonthlyHistory(providerUserId: string) {
    const months: { month: string; rate: number }[] = [];
    const now = new Date();

    for (let i = 1; i <= 3; i++) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const monthStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;

      const barberProfile = await this.prisma.client.barberProfile.findUnique({
        where: { userId: providerUserId },
        select: { id: true },
      });
      if (!barberProfile) break;

      const [cancelCount, totalBookings] = await Promise.all([
        this.prisma.client.cancellationRecord.count({
          where: { providerUserId, cancelledAt: { gte: start, lte: end }, deletedAt: null },
        }),
        this.prisma.client.booking.count({
          where: { barberId: barberProfile.id, scheduledAt: { gte: start, lte: end }, deletedAt: null },
        }),
      ]);

      const rate = totalBookings > 0 ? (cancelCount / totalBookings) * 100 : 0;
      months.push({ month: monthStr, rate: Math.round(rate * 10) / 10 });
    }

    return months;
  }
}
