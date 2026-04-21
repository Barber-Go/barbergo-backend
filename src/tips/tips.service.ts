import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getSuggestedAmounts(bookingId: string, clientId: string) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, clientId, deletedAt: null },
    });
    if (!booking) throw new NotFoundException('Reserva no encontrada');

    const wallet = await this.creditsService.getOrCreateWallet(clientId);

    return {
      suggestions: [
        { label: 'Sin propina', amount: 0 },
        { label: '$1.000', amount: 1000 },
        { label: '$2.000', amount: 2000 },
        { label: '$3.000', amount: 3000 },
      ],
      clientCreditBalance: wallet.balance,
      canCustomAmount: true,
    };
  }

  async createTip(clientId: string, dto: {
    bookingId: string;
    amount: number;
    rating?: number;
    comment?: string;
    compliments?: string[];
    issues?: string[];
  }) {
    const booking = await this.prisma.client.booking.findFirst({
      where: {
        id: dto.bookingId,
        clientId,
        status: 'COMPLETED',
        hasTip: false,
        deletedAt: null,
      },
      include: {
        barber: { select: { id: true, userId: true, rating: true, totalReviews: true } },
        service: { select: { name: true } },
        review: true,
      },
    });

    if (!booking) throw new NotFoundException('Reserva no válida para propina');

    return this.prisma.client.$transaction(async (tx) => {
      // Create review if rating provided and no existing review
      if (dto.rating && !booking.review) {
        const review = await tx.review.create({
          data: {
            bookingId: booking.id,
            clientId,
            barberId: booking.barber.id,
            rating: dto.rating,
            comment: dto.comment ?? null,
            compliments: dto.compliments ?? [],
            issues: dto.issues ?? [],
          },
        });

        // Update barber average rating
        const currentTotal = booking.barber.rating * booking.barber.totalReviews;
        const newCount = booking.barber.totalReviews + 1;
        const newAvg = (currentTotal + dto.rating) / newCount;

        await tx.barberProfile.update({
          where: { id: booking.barber.id },
          data: { rating: newAvg, totalReviews: newCount },
        });
      }

      // Zero tip — just mark as done
      if (dto.amount === 0) {
        const tip = await tx.tip.create({
          data: {
            bookingId: booking.id,
            clientId,
            barberId: booking.barber.userId,
            amount: 0,
            paidFromCredits: 0,
            paidFromCard: 0,
            status: 'PAID',
            paidAt: new Date(),
          },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: { hasTip: true, tipAmount: 0, tipId: tip.id, rateReminderStatus: 'RATED' },
        });

        return { tip, webpayUrl: null };
      }

      // Tip with amount > 0
      const wallet = await tx.creditWallet.findUnique({
        where: { userId: clientId },
      });
      const walletBalance = wallet?.balance ?? 0;
      const paidFromCredits = Math.min(dto.amount, walletBalance);
      const paidFromCard = dto.amount - paidFromCredits;

      const tip = await tx.tip.create({
        data: {
          bookingId: booking.id,
          clientId,
          barberId: booking.barber.userId,
          amount: dto.amount,
          paidFromCredits,
          paidFromCard,
          status: paidFromCard > 0 ? 'PENDING' : 'PAID',
          paidAt: paidFromCard === 0 ? new Date() : null,
        },
      });

      // Deduct credits if applicable
      if (paidFromCredits > 0 && wallet) {
        const newBalance = wallet.balance - paidFromCredits;

        const creditTx = await tx.creditTransaction.create({
          data: {
            walletId: wallet.id,
            userId: clientId,
            type: 'TIP_PAYMENT',
            amount: -paidFromCredits,
            balanceAfter: newBalance,
            description: `Propina por servicio de ${booking.service.name}`,
            bookingId: booking.id,
          },
        });

        await tx.creditWallet.update({
          where: { id: wallet.id },
          data: {
            balance: newBalance,
            totalSpent: wallet.totalSpent + paidFromCredits,
          },
        });

        await tx.tip.update({
          where: { id: tip.id },
          data: { creditsTxId: creditTx.id },
        });
      }

      // Fully paid with credits
      if (paidFromCard === 0) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { hasTip: true, tipAmount: dto.amount, tipId: tip.id, rateReminderStatus: 'RATED' },
        });

        // Notify barber (fire-and-forget outside tx)
        this.notificationsService.create(
          booking.barber.userId,
          'PAYMENT_RECEIVED',
          `Recibiste una propina de $${dto.amount.toLocaleString('es-CL')}`,
          `De tu cliente por ${booking.service.name}`,
        ).catch(() => {});

        return { tip, webpayUrl: null };
      }

      // Needs card payment — return stub URL
      const webpayUrl = `/mock-webpay?amount=${paidFromCard}&session=tip-${tip.id}`;
      return { tip, webpayUrl };
    });
  }

  async getTipByBooking(bookingId: string) {
    const tip = await this.prisma.client.tip.findUnique({
      where: { bookingId },
      select: {
        id: true,
        amount: true,
        paidFromCredits: true,
        paidFromCard: true,
        status: true,
        createdAt: true,
        paidAt: true,
      },
    });
    return tip;
  }

  async getReceivedTips(barberUserId: string, from?: string, to?: string) {
    const where: Record<string, unknown> = {
      barberId: barberUserId,
      status: 'PAID',
      amount: { gt: 0 },
      deletedAt: null,
    };

    if (from || to) {
      const paidAt: Record<string, Date> = {};
      if (from) paidAt.gte = new Date(from);
      if (to) paidAt.lte = new Date(to);
      where.paidAt = paidAt;
    }

    const tips = await this.prisma.client.tip.findMany({
      where,
      include: {
        booking: { select: { id: true, scheduledAt: true } },
        client: { select: { name: true, avatarUrl: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 100,
    });

    const total = tips.reduce((sum, t) => sum + t.amount, 0);

    return { tips, total, count: tips.length };
  }

  async getMonthlyTipsTotal(barberUserId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const tips = await this.prisma.client.tip.findMany({
      where: {
        barberId: barberUserId,
        status: 'PAID',
        amount: { gt: 0 },
        paidAt: { gte: startOfMonth },
        deletedAt: null,
      },
      select: { amount: true },
    });

    const total = tips.reduce((sum, t) => sum + t.amount, 0);
    return { total, count: tips.length };
  }
}
