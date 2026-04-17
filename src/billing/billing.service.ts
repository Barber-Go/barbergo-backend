import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async getMonthly(userId: string, year: number, month: number) {
    const shop = await this.assertOwner(userId);
    const period = `${year}-${String(month).padStart(2, '0')}`;

    const record = await this.prisma.client.billingRecord.findUnique({
      where: {
        barbershopId_period: {
          barbershopId: shop.id,
          period,
        },
      },
    });

    if (!record) {
      return {
        barbershopId: shop.id,
        period,
        apiCreditsUsed: 0,
        bheEmitted: 0,
        dteEmitted: 0,
        totalCostClp: 0,
        invoiceUrl: null,
      };
    }

    return record;
  }

  async getSummary(userId: string, year: number) {
    const shop = await this.assertOwner(userId);

    const records = await this.prisma.client.billingRecord.findMany({
      where: {
        barbershopId: shop.id,
        period: { startsWith: String(year) },
      },
      orderBy: { period: 'asc' },
    });

    return records;
  }

  private async assertOwner(userId: string) {
    const shop = await this.prisma.client.barbershopProfile.findFirst({
      where: { userId },
    });
    if (!shop) throw new NotFoundException('Barbershop profile not found');
    return shop;
  }
}
