import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { LedgerEntryType } from '../generated/prisma/enums';

@Injectable()
export class FinancesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMonthlySummary(userId: string, year: number, month: number) {
    const barberIds = await this.getShopBarberIds(userId);
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const [earnings, expenses] = await Promise.all([
      this.prisma.client.earning.findMany({
        where: {
          barberId: { in: barberIds },
          date: { gte: startOfMonth, lte: endOfMonth },
        },
      }),
      this.prisma.client.expense.findMany({
        where: {
          barberId: { in: barberIds },
          date: { gte: startOfMonth, lte: endOfMonth },
        },
      }),
    ]);

    const grossRevenue = earnings.reduce((s, e) => s + Number(e.grossAmount), 0);
    const platformFees = earnings.reduce((s, e) => s + Number(e.platformFee), 0);
    const netRevenue = earnings.reduce((s, e) => s + Number(e.netAmount), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);

    return {
      year,
      month,
      grossRevenue: round2(grossRevenue),
      platformFees: round2(platformFees),
      netRevenue: round2(netRevenue),
      totalExpenses: round2(totalExpenses),
      profit: round2(netRevenue - totalExpenses),
      bookingCount: earnings.length,
    };
  }

  async getDailyLedger(userId: string, dateStr: string) {
    const barberIds = await this.getShopBarberIds(userId);
    const date = new Date(dateStr);
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const entries = await this.prisma.client.dailyLedgerEntry.findMany({
      where: {
        barberId: { in: barberIds },
        date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { createdAt: 'asc' },
    });

    return entries.map((e) => ({
      id: e.id,
      type: e.type,
      label: e.label,
      amount: Number(e.amount),
      date: e.date.toISOString(),
    }));
  }

  async createExpense(userId: string, dto: CreateExpenseDto) {
    const barberIds = await this.getShopBarberIds(userId);
    const barberId = barberIds[0]; // Use first barber as default owner

    if (!barberId) throw new NotFoundException('No barbers in shop');

    const expense = await this.prisma.client.expense.create({
      data: {
        barberId,
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        date: new Date(dto.date),
        receiptUrl: dto.receiptUrl,
      },
    });

    // Auto-create ledger entry
    await this.prisma.client.dailyLedgerEntry.create({
      data: {
        barberId,
        date: new Date(dto.date),
        type: LedgerEntryType.EXPENSE,
        label: `${dto.category}: ${dto.description ?? 'Gasto manual'}`,
        amount: dto.amount,
      },
    });

    return {
      id: expense.id,
      category: expense.category,
      description: expense.description,
      amount: Number(expense.amount),
      date: expense.date.toISOString(),
      receiptUrl: expense.receiptUrl,
    };
  }

  async getBarberBreakdown(userId: string, year: number, month: number) {
    const barberIds = await this.getShopBarberIds(userId);
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const earnings = await this.prisma.client.earning.findMany({
      where: {
        barberId: { in: barberIds },
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      include: {
        barber: { select: { user: { select: { name: true } } } },
      },
    });

    const byBarber = new Map<
      string,
      { name: string; gross: number; fees: number; net: number; count: number }
    >();

    for (const e of earnings) {
      const key = e.barberId;
      const existing = byBarber.get(key) ?? {
        name: e.barber.user.name,
        gross: 0,
        fees: 0,
        net: 0,
        count: 0,
      };
      existing.gross += Number(e.grossAmount);
      existing.fees += Number(e.platformFee);
      existing.net += Number(e.netAmount);
      existing.count++;
      byBarber.set(key, existing);
    }

    return Array.from(byBarber.entries()).map(([barberId, data]) => ({
      barberId,
      name: data.name,
      gross: round2(data.gross),
      fees: round2(data.fees),
      net: round2(data.net),
      count: data.count,
    }));
  }

  // ── Helpers ──

  private async getShopBarberIds(userId: string): Promise<string[]> {
    const shop = await this.prisma.client.barbershopProfile.findFirst({
      where: { userId },
      include: { staff: { where: { isActive: true }, select: { barberProfileId: true } } },
    });
    if (!shop) throw new NotFoundException('Barbershop profile not found');
    return shop.staff.map((s) => s.barberProfileId);
  }
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
