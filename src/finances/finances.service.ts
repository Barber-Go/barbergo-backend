import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/create-expense.dto';
import { LedgerEntryType, BookingStatus } from '../generated/prisma/enums';

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
    const shops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      include: { staff: { where: { isActive: true }, select: { barberProfileId: true }, take: 1 } },
    });
    if (!shops.length) throw new NotFoundException('No barbershops found');

    const targetShop = dto.barbershopId ? shops.find((s) => s.id === dto.barbershopId) : shops[0];
    if (!targetShop) throw new NotFoundException('Barbershop not found');

    const barberId = targetShop.staff[0]?.barberProfileId ?? shops.flatMap((s) => s.staff).map((s) => s.barberProfileId)[0];
    if (!barberId) throw new NotFoundException('No barbers in shop');

    const expense = await this.prisma.client.expense.create({
      data: {
        barberId,
        barbershopId: dto.barbershopId ?? targetShop.id,
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

  // ── Scope-aware summary ──

  async getSummary(userId: string, period: string = 'month', barbershopId?: string) {
    const shops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null, ...(barbershopId ? { id: barbershopId } : {}) },
      select: { id: true, name: true },
    });
    if (!shops.length) throw new NotFoundException('No barbershops found');

    const shopIds = shops.map((s) => s.id);
    const scopeName = barbershopId ? (shops[0]?.name ?? 'Barberia') : 'Todas las barberias';

    const { rangeFrom, rangeTo } = this.resolvePeriod(period);
    const prevDays = Math.max(1, Math.round((rangeTo.getTime() - rangeFrom.getTime()) / 86400000));
    const prevFrom = new Date(rangeFrom.getTime() - prevDays * 86400000);
    const prevTo = new Date(rangeFrom.getTime() - 1);

    // Current period bookings
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        barbershopId: { in: shopIds },
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: rangeFrom, lte: rangeTo },
        deletedAt: null,
      },
      select: { grossAmount: true, barberAmount: true, shopAmount: true, platformFee: true },
    });

    let totalRevenue = 0;
    let barberPayouts = 0;
    let platformFees = 0;
    for (const b of bookings) {
      totalRevenue += Number(b.grossAmount);
      barberPayouts += Number(b.barberAmount);
      platformFees += Number(b.platformFee);
    }
    const netRevenue = totalRevenue - barberPayouts - platformFees;

    // Expenses
    const expenses = await this.prisma.client.expense.findMany({
      where: {
        barbershopId: barbershopId ? barbershopId : { in: shopIds },
        date: { gte: rangeFrom, lte: rangeTo },
        deletedAt: null,
      },
      select: { amount: true, category: true },
    });

    let totalExpenses = 0;
    const byCategory: Record<string, number> = { RENT: 0, PRODUCTS: 0, MARKETING: 0, UTILITIES: 0, SALARIES: 0, OTHER: 0 };
    for (const e of expenses) {
      const amt = Number(e.amount);
      totalExpenses += amt;
      const cat = e.category.toUpperCase();
      if (cat in byCategory) byCategory[cat] += amt;
      else byCategory.OTHER += amt;
    }

    const profit = netRevenue - totalExpenses;
    const margin = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 1000) / 10 : 0;

    // Previous period
    const prevBookings = await this.prisma.client.booking.findMany({
      where: {
        barbershopId: { in: shopIds },
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: prevFrom, lte: prevTo },
        deletedAt: null,
      },
      select: { grossAmount: true, barberAmount: true, platformFee: true },
    });
    let prevRevenue = 0;
    let prevBarberPay = 0;
    let prevPlatform = 0;
    for (const b of prevBookings) {
      prevRevenue += Number(b.grossAmount);
      prevBarberPay += Number(b.barberAmount);
      prevPlatform += Number(b.platformFee);
    }
    const prevNet = prevRevenue - prevBarberPay - prevPlatform;

    const prevExpenses = await this.prisma.client.expense.aggregate({
      where: {
        barbershopId: barbershopId ? barbershopId : { in: shopIds },
        date: { gte: prevFrom, lte: prevTo },
        deletedAt: null,
      },
      _sum: { amount: true },
    });
    const prevExpTotal = Number(prevExpenses._sum.amount ?? 0);
    const prevProfit = prevNet - prevExpTotal;

    const pct = (cur: number, prev: number) => prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : 0;

    return {
      data: {
        period: { type: period, from: rangeFrom.toISOString().slice(0, 10), to: rangeTo.toISOString().slice(0, 10) },
        scope: { barbershopId: barbershopId ?? null, name: scopeName },
        revenue: {
          total: Math.round(totalRevenue),
          barberPayouts: Math.round(barberPayouts),
          platformFees: Math.round(platformFees),
          netRevenue: Math.round(netRevenue),
        },
        expenses: {
          total: Math.round(totalExpenses),
          byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, Math.round(v)])),
        },
        profit: { amount: Math.round(profit), margin },
        comparison: { revenuePct: pct(totalRevenue, prevRevenue), expensesPct: pct(totalExpenses, prevExpTotal), profitPct: pct(profit, prevProfit) },
      },
      message: 'OK',
      statusCode: 200,
    };
  }

  // ── Expenses list ──

  async getExpenses(userId: string, barbershopId?: string, category?: string, from?: string, to?: string) {
    const shops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true },
    });
    const shopIds = shops.map((s) => s.id);
    const shopMap = new Map(shops.map((s) => [s.id, s.name]));

    const where: Record<string, unknown> = { deletedAt: null };
    if (barbershopId) {
      where.barbershopId = barbershopId;
    } else {
      where.barbershopId = { in: shopIds };
    }
    if (category) where.category = category;
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) dateFilter.lte = new Date(to);
      where.date = dateFilter;
    }

    const expenses = await this.prisma.client.expense.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 50,
    });

    const LABELS: Record<string, string> = {
      RENT: 'Arriendo', PRODUCTS: 'Productos', MARKETING: 'Marketing',
      UTILITIES: 'Servicios', SALARIES: 'Sueldos fijos', OTHER: 'Otros',
    };

    const mapped = expenses.map((e) => ({
      id: e.id,
      category: e.category,
      categoryLabel: LABELS[e.category.toUpperCase()] ?? e.category,
      amount: Math.round(Number(e.amount)),
      description: e.description ?? '',
      expenseDate: e.date.toISOString().slice(0, 10),
      barbershop: e.barbershopId ? { id: e.barbershopId, name: shopMap.get(e.barbershopId) ?? 'Barberia' } : null,
    }));

    const total = mapped.reduce((s, e) => s + e.amount, 0);
    return { data: { expenses: mapped, total, count: mapped.length }, message: 'OK', statusCode: 200 };
  }

  // ── Expense CRUD extensions ──

  async updateExpense(userId: string, expenseId: string, dto: UpdateExpenseDto) {
    const expense = await this.prisma.client.expense.findFirst({ where: { id: expenseId, deletedAt: null } });
    if (!expense) throw new NotFoundException('Expense not found');

    // Verify ownership
    const shops = await this.prisma.client.barbershopProfile.findMany({ where: { userId, deletedAt: null }, select: { id: true } });
    const shopIds = shops.map((s) => s.id);
    if (expense.barbershopId && !shopIds.includes(expense.barbershopId)) throw new ForbiddenException();

    const data: Record<string, unknown> = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.barbershopId !== undefined) data.barbershopId = dto.barbershopId;

    const updated = await this.prisma.client.expense.update({ where: { id: expenseId }, data });
    return {
      data: { id: updated.id, category: updated.category, amount: Math.round(Number(updated.amount)) },
      message: 'Updated',
      statusCode: 200,
    };
  }

  async deleteExpense(userId: string, expenseId: string) {
    const expense = await this.prisma.client.expense.findFirst({ where: { id: expenseId, deletedAt: null } });
    if (!expense) throw new NotFoundException('Expense not found');

    const shops = await this.prisma.client.barbershopProfile.findMany({ where: { userId, deletedAt: null }, select: { id: true } });
    const shopIds = shops.map((s) => s.id);
    if (expense.barbershopId && !shopIds.includes(expense.barbershopId)) throw new ForbiddenException();

    await this.prisma.client.expense.update({ where: { id: expenseId }, data: { deletedAt: new Date() } });
    return { message: 'Deleted', statusCode: 200 };
  }

  // ── Monthly ledger ──

  async getMonthlyLedger(userId: string, barbershopId?: string, monthStr?: string) {
    const now = new Date();
    const [year, month] = monthStr ? monthStr.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];

    const shops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null, ...(barbershopId ? { id: barbershopId } : {}) },
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    const rangeFrom = new Date(Date.UTC(year, month - 1, 1));
    const rangeTo = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const daysInMonth = new Date(year, month, 0).getDate();

    // Bookings by day
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        barbershopId: { in: shopIds },
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: rangeFrom, lte: rangeTo },
        deletedAt: null,
      },
      select: { scheduledAt: true, shopAmount: true },
    });

    // Expenses by day
    const expenses = await this.prisma.client.expense.findMany({
      where: {
        barbershopId: barbershopId ? barbershopId : { in: shopIds },
        date: { gte: rangeFrom, lte: rangeTo },
        deletedAt: null,
      },
      select: { date: true, amount: true },
    });

    const dayMap = new Map<string, { income: number; expenses: number }>();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dayMap.set(key, { income: 0, expenses: 0 });
    }

    for (const b of bookings) {
      const key = b.scheduledAt.toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry) entry.income += Number(b.shopAmount);
    }
    for (const e of expenses) {
      const key = e.date.toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry) entry.expenses += Number(e.amount);
    }

    let accumulated = 0;
    const days = [...dayMap.entries()].map(([date, v]) => {
      const profit = Math.round(v.income) - Math.round(v.expenses);
      accumulated += profit;
      return { date, income: Math.round(v.income), expenses: Math.round(v.expenses), profit, accumulatedProfit: accumulated };
    });

    return { data: { month: `${year}-${String(month).padStart(2, '0')}`, days }, message: 'OK', statusCode: 200 };
  }

  // ── Period resolver ──

  private resolvePeriod(period: string) {
    const now = new Date();
    switch (period) {
      case 'today': {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case 'week': {
        const day = now.getUTCDay();
        const diff = day === 0 ? 6 : day - 1;
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case 'last_month': {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case 'year': {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      default: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
    }
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
