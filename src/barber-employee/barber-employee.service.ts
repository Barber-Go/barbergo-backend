import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookingStatus } from '../generated/prisma/enums';
import { EmployeeDashboardPeriod } from './dto/dashboard-query.dto';

@Injectable()
export class BarberEmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string, period: EmployeeDashboardPeriod = EmployeeDashboardPeriod.MONTH) {
    const profile = await this.prisma.client.barberProfile.findUnique({
      where: { userId },
      include: {
        staffMemberships: {
          where: { isActive: true },
          include: {
            barbershop: { select: { name: true } },
            compensationRules: { where: { isActive: true }, take: 1 },
          },
          take: 1,
        },
      },
    });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const membership = profile.staffMemberships[0];
    const shopName = membership?.barbershop?.name ?? 'Sin barberia';
    const barberPercent = membership?.compensationRules?.[0]?.percentage ?? 60;

    const { rangeFrom, rangeTo } = this.resolveDateRange(period);

    // Current period bookings
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        barberId: profile.id,
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: rangeFrom, lte: rangeTo },
        deletedAt: null,
      },
      select: {
        grossAmount: true,
        barberAmount: true,
        paymentMethod: true,
        scheduledAt: true,
        service: { select: { name: true } },
      },
    });

    // Previous period for comparison
    const periodDays = Math.max(1, Math.round((rangeTo.getTime() - rangeFrom.getTime()) / 86400000));
    const prevFrom = new Date(rangeFrom.getTime() - periodDays * 86400000);
    const prevTo = new Date(rangeFrom.getTime() - 1);
    const prevBookings = await this.prisma.client.booking.count({
      where: {
        barberId: profile.id,
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: prevFrom, lte: prevTo },
        deletedAt: null,
      },
    });
    let prevEarnings = 0;
    const prevRows = await this.prisma.client.booking.findMany({
      where: {
        barberId: profile.id,
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: prevFrom, lte: prevTo },
        deletedAt: null,
      },
      select: { barberAmount: true },
    });
    for (const r of prevRows) prevEarnings += Number(r.barberAmount);

    // KPIs
    let myEarnings = 0;
    let totalGross = 0;
    let platformFee = 0;
    for (const b of bookings) {
      myEarnings += Number(b.barberAmount);
      totalGross += Number(b.grossAmount);
      platformFee += Number(b.platformFee);
    }
    const totalBookings = bookings.length;
    const avgTicket = totalBookings > 0 ? Math.round(myEarnings / totalBookings) : 0;

    const earningsPct = prevEarnings > 0 ? Math.round(((myEarnings - prevEarnings) / prevEarnings) * 1000) / 10 : 0;
    const bookingsPct = prevBookings > 0 ? Math.round(((totalBookings - prevBookings) / prevBookings) * 1000) / 10 : 0;

    // Rating
    const ratingAgg = await this.prisma.client.review.aggregate({
      where: { barberId: profile.id },
      _avg: { rating: true },
      _count: true,
    });
    const averageRating = ratingAgg._avg.rating ? Math.round(ratingAgg._avg.rating * 10) / 10 : 0;
    const totalReviews = ratingAgg._count;

    // Unique clients
    const clientIds = new Set<string>();
    const clientBookings = await this.prisma.client.booking.findMany({
      where: {
        barberId: profile.id,
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: rangeFrom, lte: rangeTo },
        deletedAt: null,
      },
      select: { clientId: true },
    });
    for (const cb of clientBookings) clientIds.add(cb.clientId);

    // Earnings by day
    const dayMap = new Map<string, { earnings: number; bookings: number }>();
    const cursor = new Date(rangeFrom);
    while (cursor <= rangeTo) {
      dayMap.set(cursor.toISOString().slice(0, 10), { earnings: 0, bookings: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    for (const b of bookings) {
      const day = b.scheduledAt.toISOString().slice(0, 10);
      const entry = dayMap.get(day);
      if (entry) {
        entry.earnings += Number(b.barberAmount);
        entry.bookings += 1;
      }
    }
    const earningsByDay = [...dayMap.entries()].map(([date, v]) => ({
      date,
      earnings: Math.round(v.earnings),
      bookings: v.bookings,
    }));

    // Service distribution
    const serviceMap = new Map<string, { count: number; earnings: number }>();
    for (const b of bookings) {
      const name = b.service?.name ?? 'Otro';
      const entry = serviceMap.get(name);
      if (entry) {
        entry.count += 1;
        entry.earnings += Number(b.barberAmount);
      } else {
        serviceMap.set(name, { count: 1, earnings: Number(b.barberAmount) });
      }
    }
    const serviceDistribution = [...serviceMap.entries()].map(([serviceName, v]) => ({
      serviceName,
      count: v.count,
      earnings: Math.round(v.earnings),
    }));

    // Payment method distribution
    const pmDist = { IN_APP: { count: 0, amount: 0 }, CASH: { count: 0, amount: 0 } };
    for (const b of bookings) {
      const key = b.paymentMethod === 'CASH' ? 'CASH' : 'IN_APP';
      pmDist[key].count += 1;
      pmDist[key].amount += Number(b.barberAmount);
    }
    pmDist.IN_APP.amount = Math.round(pmDist.IN_APP.amount);
    pmDist.CASH.amount = Math.round(pmDist.CASH.amount);

    // Upcoming bookings
    const upcoming = await this.prisma.client.booking.findMany({
      where: {
        barberId: profile.id,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
        scheduledAt: { gt: new Date() },
        deletedAt: null,
      },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
      include: {
        client: { select: { name: true } },
        service: { select: { name: true, durationMin: true } },
      },
    });

    // Recent reviews
    const recentReviews = await this.prisma.client.review.findMany({
      where: { barberId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { client: { select: { name: true } } },
    });

    return {
      data: {
        barber: {
          name: user?.name ?? 'Barbero',
          shopName,
          barberPercent: Math.round(barberPercent),
        },
        period: {
          type: period,
          from: rangeFrom.toISOString().slice(0, 10),
          to: rangeTo.toISOString().slice(0, 10),
        },
        kpis: {
          myEarnings: Math.round(myEarnings),
          totalBookings,
          averageRating,
          totalReviews,
          avgTicket,
          uniqueClients: clientIds.size,
          platformFee: Math.round(platformFee),
          totalGross: Math.round(totalGross),
          comparison: { earningsPct, bookingsPct },
        },
        earningsByDay,
        serviceDistribution,
        paymentMethodDistribution: pmDist,
        upcomingBookings: upcoming.map((b) => ({
          id: b.id,
          scheduledAt: b.scheduledAt.toISOString(),
          clientName: b.client.name,
          serviceName: b.service.name,
          duration: b.service.durationMin,
          myEarnings: Math.round(Number(b.barberAmount ?? 0)),
        })),
        recentReviews: recentReviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment ?? '',
          clientName: r.client.name,
          date: r.createdAt.toISOString().slice(0, 10),
        })),
      },
      message: 'OK',
      statusCode: 200,
    };
  }

  private resolveDateRange(period: EmployeeDashboardPeriod) {
    const now = new Date();
    switch (period) {
      case EmployeeDashboardPeriod.TODAY: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case EmployeeDashboardPeriod.WEEK: {
        const day = now.getUTCDay();
        const diff = day === 0 ? 6 : day - 1;
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case EmployeeDashboardPeriod.LAST_MONTH: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      default: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
    }
  }
}
