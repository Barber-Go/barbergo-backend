import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  async accruePoints(userId: string, amountPaid: number): Promise<void> {
    const earned = Math.floor(amountPaid / 10);
    if (earned <= 0) return;

    await this.prisma.client.pointsWallet.upsert({
      where: { userId },
      create: {
        userId,
        balance: earned,
        lifetime: earned,
        lastActivityAt: new Date(),
      },
      update: {
        balance: { increment: earned },
        lifetime: { increment: earned },
        lastActivityAt: new Date(),
      },
    });
  }

  async getBalance(userId: string) {
    const wallet = await this.prisma.client.pointsWallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return { balance: 0, lifetime: 0, expiresAt: null };
    }

    // Check 90-day expiry
    const daysSinceActivity = Math.floor(
      (Date.now() - wallet.lastActivityAt.getTime()) / 86400000,
    );

    if (daysSinceActivity >= 90 && wallet.balance > 0) {
      await this.prisma.client.pointsWallet.update({
        where: { userId },
        data: { balance: 0 },
      });
      return { balance: 0, lifetime: wallet.lifetime, expiresAt: null };
    }

    const expiresAt = new Date(wallet.lastActivityAt);
    expiresAt.setDate(expiresAt.getDate() + 90);

    return {
      balance: wallet.balance,
      lifetime: wallet.lifetime,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getRewards() {
    return this.prisma.client.rewardsCatalog.findMany({
      where: { isActive: true },
      orderBy: { pointsCost: 'asc' },
    });
  }
}
