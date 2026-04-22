import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.client.creditWallet.findUnique({
      where: { userId },
    });
    if (!wallet) {
      wallet = await this.prisma.client.creditWallet.create({
        data: { userId, balance: 0, totalEarned: 0, totalSpent: 0 },
      });
    }
    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const expiringSoon = await this.prisma.client.creditTransaction.findMany({
      where: {
        userId,
        amount: { gt: 0 },
        isExpired: false,
        expiresAt: { lte: thirtyDaysFromNow, gte: new Date() },
        deletedAt: null,
      },
      select: { amount: true, expiresAt: true },
    });

    return {
      balance: wallet.balance,
      totalEarned: wallet.totalEarned,
      totalSpent: wallet.totalSpent,
      expiringSoon,
    };
  }

  async getHistory(userId: string, limit = 50, offset = 0) {
    const [transactions, total] = await Promise.all([
      this.prisma.client.creditTransaction.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          description: true,
          createdAt: true,
          expiresAt: true,
          bookingId: true,
          isExpired: true,
        },
      }),
      this.prisma.client.creditTransaction.count({
        where: { userId, deletedAt: null },
      }),
    ]);

    return {
      transactions,
      total,
      hasMore: offset + transactions.length < total,
    };
  }

  async grantByAdmin(params: {
    userId: string;
    amount: number;
    description: string;
    adminId: string;
    metadata?: Record<string, unknown>;
  }) {
    // Verify target user exists
    const user = await this.prisma.client.user.findUnique({
      where: { id: params.userId },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return this.prisma.client.$transaction(async (tx) => {
      const wallet = await tx.creditWallet.upsert({
        where: { userId: params.userId },
        create: { userId: params.userId, balance: 0, totalEarned: 0, totalSpent: 0 },
        update: {},
      });

      const newBalance = wallet.balance + params.amount;
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 12);

      const transaction = await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          userId: params.userId,
          type: 'ADMIN_GRANT',
          amount: params.amount,
          remainingAmount: params.amount,
          balanceAfter: newBalance,
          description: params.description,
          metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
          expiresAt,
          grantedByAdminId: params.adminId,
        },
      });

      await tx.creditWallet.update({
        where: { id: wallet.id },
        data: {
          balance: newBalance,
          totalEarned: wallet.totalEarned + params.amount,
        },
      });

      return transaction;
    });
  }

  async createRefund(
    params: {
      userId: string;
      amount: number;
      bookingId: string;
      description: string;
    },
    tx?: Tx,
  ) {
    const run = async (client: Tx) => {
      const wallet = await client.creditWallet.upsert({
        where: { userId: params.userId },
        create: { userId: params.userId, balance: 0, totalEarned: 0, totalSpent: 0 },
        update: {},
      });

      const newBalance = wallet.balance + params.amount;
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 12);

      const transaction = await client.creditTransaction.create({
        data: {
          walletId: wallet.id,
          userId: params.userId,
          type: 'REFUND',
          amount: params.amount,
          remainingAmount: params.amount,
          balanceAfter: newBalance,
          description: params.description,
          bookingId: params.bookingId,
          expiresAt,
        },
      });

      await client.creditWallet.update({
        where: { id: wallet.id },
        data: {
          balance: newBalance,
          totalEarned: wallet.totalEarned + params.amount,
        },
      });

      return transaction;
    };

    if (tx) return run(tx);
    return this.prisma.client.$transaction(run);
  }

  async createBonus(
    params: {
      userId: string;
      amount: number;
      bookingId: string;
      description: string;
    },
    tx?: Tx,
  ) {
    const run = async (client: Tx) => {
      const wallet = await client.creditWallet.upsert({
        where: { userId: params.userId },
        create: { userId: params.userId, balance: 0, totalEarned: 0, totalSpent: 0 },
        update: {},
      });

      const newBalance = wallet.balance + params.amount;
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 12);

      const transaction = await client.creditTransaction.create({
        data: {
          walletId: wallet.id,
          userId: params.userId,
          type: 'ADMIN_GRANT',
          amount: params.amount,
          remainingAmount: params.amount,
          balanceAfter: newBalance,
          description: params.description,
          bookingId: params.bookingId,
          expiresAt,
        },
      });

      await client.creditWallet.update({
        where: { id: wallet.id },
        data: {
          balance: newBalance,
          totalEarned: wallet.totalEarned + params.amount,
        },
      });

      return transaction;
    };

    if (tx) return run(tx);
    return this.prisma.client.$transaction(run);
  }

  async spendCredits(params: {
    userId: string;
    amount: number;
    bookingId: string;
  }) {
    return this.prisma.client.$transaction(async (tx) => {
      const wallet = await tx.creditWallet.findUnique({
        where: { userId: params.userId },
      });

      if (!wallet || wallet.balance < params.amount) {
        throw new BadRequestException('Saldo insuficiente');
      }

      // FIFO: consume the positive transactions closest to expiration first.
      // Nulls (no expiry) go last. Only active credits (not expired, not deleted).
      const available = await tx.creditTransaction.findMany({
        where: {
          walletId: wallet.id,
          remainingAmount: { gt: 0 },
          isExpired: false,
          deletedAt: null,
          type: { in: ['REFUND', 'ADMIN_GRANT'] },
        },
        orderBy: [
          { expiresAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
        ],
      });

      let remaining = params.amount;
      const consumedFrom: { id: string; amount: number }[] = [];

      for (const credit of available) {
        if (remaining === 0) break;
        const take = Math.min(credit.remainingAmount, remaining);
        await tx.creditTransaction.update({
          where: { id: credit.id },
          data: { remainingAmount: credit.remainingAmount - take },
        });
        consumedFrom.push({ id: credit.id, amount: take });
        remaining -= take;
      }

      if (remaining > 0) {
        // Shouldn't happen if wallet.balance was correct; fail safely.
        throw new BadRequestException('Saldo insuficiente');
      }

      const newBalance = wallet.balance - params.amount;

      const transaction = await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          userId: params.userId,
          type: 'BOOKING_PAYMENT',
          amount: -params.amount,
          balanceAfter: newBalance,
          description: 'Pago de reserva con créditos',
          bookingId: params.bookingId,
          metadata: { consumedFrom },
        },
      });

      await tx.creditWallet.update({
        where: { id: wallet.id },
        data: {
          balance: newBalance,
          totalSpent: wallet.totalSpent + params.amount,
        },
      });

      return transaction;
    });
  }

  async getAdminUserBalance(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const balance = await this.getBalance(userId);
    return { ...user, ...balance };
  }

  @Cron('0 3 * * *') // 3 AM daily
  async expireOldCredits() {
    this.logger.log('Running credit expiration cron job');
    // Only expire the UNSPENT portion: remainingAmount drives the wallet
    // balance delta, not the original amount. A credit partially consumed
    // by prior spends should expire only the leftover.
    const expired = await this.prisma.client.creditTransaction.findMany({
      where: {
        expiresAt: { lt: new Date() },
        isExpired: false,
        remainingAmount: { gt: 0 },
        type: { in: ['REFUND', 'ADMIN_GRANT'] },
        deletedAt: null,
      },
    });

    let expiredCount = 0;

    for (const tx of expired) {
      await this.prisma.client.$transaction(async (client) => {
        await client.creditTransaction.update({
          where: { id: tx.id },
          data: { isExpired: true, remainingAmount: 0 },
        });

        const wallet = await client.creditWallet.findUnique({
          where: { id: tx.walletId },
        });
        if (!wallet) return;

        const newBalance = Math.max(0, wallet.balance - tx.remainingAmount);

        await client.creditTransaction.create({
          data: {
            walletId: tx.walletId,
            userId: tx.userId,
            type: 'EXPIRED',
            amount: -tx.remainingAmount,
            balanceAfter: newBalance,
            description: `Expiración de créditos del ${tx.createdAt.toISOString().split('T')[0]}`,
          },
        });

        await client.creditWallet.update({
          where: { id: tx.walletId },
          data: { balance: newBalance },
        });
      });

      expiredCount++;
    }

    this.logger.log(`Expired ${expiredCount} credit transactions`);
    return { expiredCount };
  }
}
