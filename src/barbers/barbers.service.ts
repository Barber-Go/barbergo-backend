import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { haversineKm } from '../shared/geo.utils';
import { encrypt, decrypt } from '../shared/crypto.utils';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateBarberProfileDto } from './dto/update-barber-profile.dto';
import { UpdateSiiCredentialsDto } from './dto/update-sii-credentials.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { DashboardPeriod } from './dto/dashboard-query.dto';
import { BookingStatus } from '../generated/prisma/enums';

export interface BarberResponse {
  id: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  rating: number;
  totalReviews: number;
  bio: string | null;
  lat: number | null;
  lng: number | null;
  distance?: number;
  services: {
    id: string;
    name: string;
    price: number;
    durationMin: number;
  }[];
}

export interface ReviewResponse {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  clientName: string;
  clientAvatarUrl: string | null;
}

@Injectable()
export class BarbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findAll(
    lat?: number,
    lng?: number,
    radius: number = 10,
  ): Promise<BarberResponse[]> {
    const users = await this.prisma.client.user.findMany({
      where: {
        role: { in: ['BARBER', 'BARBER_INDEPENDENT', 'BARBER_EMPLOYEE'] },
        barberProfile: { isActive: true, isCurrentlySuspended: false },
      },
      include: {
        barberProfile: {
          include: {
            services: {
              where: { isActive: true },
              select: { id: true, name: true, price: true, durationMin: true },
            },
          },
        },
      },
    });

    const barbers: BarberResponse[] = users
      .filter((u) => u.barberProfile !== null)
      .map((u) => {
        const profile = u.barberProfile!;
        const distance =
          lat != null && lng != null && profile.lat != null && profile.lng != null
            ? haversineKm(lat, lng, profile.lat, profile.lng)
            : undefined;

        return {
          id: profile.id,
          name: u.name,
          phone: u.phone,
          avatarUrl: u.avatarUrl,
          rating: profile.rating,
          totalReviews: profile.totalReviews,
          bio: profile.bio,
          lat: profile.lat,
          lng: profile.lng,
          distance,
          services: profile.services.map((s) => ({
            id: s.id,
            name: s.name,
            price: Number(s.price),
            durationMin: s.durationMin,
          })),
        };
      });

    // Filter by radius when coordinates are provided
    const filtered =
      lat != null && lng != null
        ? barbers.filter((b) => b.distance == null || b.distance <= radius)
        : barbers;

    // Sort: distance first, then rating (warning-flagged barbers pushed down)
    return filtered.sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      return b.rating - a.rating;
    });
  }

  // ── Barber self-management ─────────────────────────────────────────────────

  async findMe(userId: string) {
    const profile = await this.prisma.client.barberProfile.findUnique({
      where: { userId },
      include: {
        user: true,
        services: {
          where: { isActive: true },
          select: { id: true, name: true, description: true, price: true, durationMin: true, isActive: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!profile) throw new NotFoundException('Barber profile not found');

    return this.formatMe(profile);
  }

  async updateMe(userId: string, dto: UpdateBarberProfileDto) {
    const profile = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    // Split: name/phone/avatarUrl → User; bio → Barber
    const [updatedUser] = await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        },
      }),
      this.prisma.client.barberProfile.update({
        where: { userId },
        data: {
          ...(dto.bio !== undefined && { bio: dto.bio }),
        },
      }),
    ]);

    return this.findMe(userId);
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    const url = await this.storage.uploadImage(file, 'avatars');

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { avatarUrl: url },
    });

    return { avatarUrl: url };
  }

  async createService(userId: string, dto: CreateServiceDto) {
    const profile = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const service = await this.prisma.client.serviceItem.create({
      data: {
        barberId: profile.id,
        name: dto.name,
        price: dto.price,
        durationMin: dto.durationMin,
        description: dto.description,
      },
    });

    return {
      id: service.id,
      name: service.name,
      description: service.description,
      price: Number(service.price),
      durationMin: service.durationMin,
      isActive: service.isActive,
    };
  }

  async updateService(userId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.assertServiceOwnership(userId, serviceId);

    const service = await this.prisma.client.serviceItem.update({
      where: { id: serviceId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.durationMin !== undefined && { durationMin: dto.durationMin }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    return {
      id: service.id,
      name: service.name,
      description: service.description,
      price: Number(service.price),
      durationMin: service.durationMin,
      isActive: service.isActive,
    };
  }

  async deleteService(userId: string, serviceId: string) {
    await this.assertServiceOwnership(userId, serviceId);

    await this.prisma.client.serviceItem.update({
      where: { id: serviceId },
      data: { isActive: false },
    });

    return { message: 'Servicio eliminado correctamente' };
  }

  // ── SII credentials ────────────────────────────────────────────────────────

  async getSiiCredentials(userId: string) {
    const profile = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');
    if (!profile.rutTributario || !profile.claveTributaria) {
      throw new NotFoundException('No SII credentials configured');
    }

    return {
      rut: profile.rutTributario,
      tipoClave: profile.tipoClaveSii ?? 'tributaria',
      clave: decrypt(profile.claveTributaria),
    };
  }

  async updateSiiCredentials(userId: string, dto: UpdateSiiCredentialsDto) {
    const profile = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    await this.prisma.client.barberProfile.update({
      where: { userId },
      data: {
        rutTributario: dto.rut,
        tipoClaveSii: dto.tipoClave,
        claveTributaria: encrypt(dto.clave),
      },
    });

    return { success: true };
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  async getDashboard(userId: string, period: DashboardPeriod, from?: string, to?: string) {
    const profile = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const { rangeFrom, rangeTo } = this.resolveDateRange(period, from, to);

    // Completed bookings in range
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        barberId: profile.id,
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: rangeFrom, lte: rangeTo },
      },
      select: {
        grossAmount: true,
        platformFee: true,
        barberNet: true,
        paymentMethod: true,
        scheduledAt: true,
      },
    });

    // KPIs
    let totalGross = 0;
    let platformFee = 0;
    let netEarnings = 0;
    for (const b of bookings) {
      totalGross += Number(b.grossAmount);
      platformFee += Number(b.platformFee);
      netEarnings += Number(b.barberNet);
    }

    // Income by day
    const dayMap = new Map<string, { gross: number; net: number }>();
    const cursor = new Date(rangeFrom);
    while (cursor <= rangeTo) {
      dayMap.set(cursor.toISOString().slice(0, 10), { gross: 0, net: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    for (const b of bookings) {
      const day = b.scheduledAt.toISOString().slice(0, 10);
      const entry = dayMap.get(day);
      if (entry) {
        entry.gross += Number(b.grossAmount);
        entry.net += Number(b.barberNet);
      }
    }
    const incomeByDay = [...dayMap.entries()].map(([date, v]) => ({
      date,
      gross: Math.round(v.gross),
      net: Math.round(v.net),
    }));

    // Payment method distribution
    const dist: Record<string, { count: number; amount: number }> = {
      IN_APP: { count: 0, amount: 0 },
      CASH: { count: 0, amount: 0 },
    };
    for (const b of bookings) {
      const key = b.paymentMethod === 'CASH' ? 'CASH' : 'IN_APP';
      dist[key].count += 1;
      dist[key].amount += Number(b.grossAmount);
    }
    dist.IN_APP.amount = Math.round(dist.IN_APP.amount);
    dist.CASH.amount = Math.round(dist.CASH.amount);

    // Upcoming bookings (max 3 confirmed future)
    const upcoming = await this.prisma.client.booking.findMany({
      where: {
        barberId: profile.id,
        status: BookingStatus.CONFIRMED,
        scheduledAt: { gt: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
      include: {
        client: { select: { name: true } },
        service: { select: { name: true } },
      },
    });

    // Booking source distribution (app vs direct/manual)
    const manualCount = await this.prisma.client.manualBooking.count({
      where: { barberId: profile.id, date: { gte: rangeFrom, lte: rangeTo } },
    });

    const sourceDist = {
      APP: { count: bookings.length, amount: Math.round(totalGross) },
      DIRECT: { count: manualCount, amount: 0 },
    };

    return {
      data: {
        period: {
          type: period,
          from: rangeFrom.toISOString().slice(0, 10),
          to: rangeTo.toISOString().slice(0, 10),
        },
        kpis: {
          totalGross: Math.round(totalGross),
          platformFee: Math.round(platformFee),
          netEarnings: Math.round(netEarnings),
          bookingsCount: bookings.length,
        },
        incomeByDay,
        paymentMethodDistribution: dist,
        bookingSourceDistribution: sourceDist,
        upcomingBookings: upcoming.map((b) => ({
          id: b.id,
          clientName: b.client.name,
          serviceName: b.service.name,
          scheduledAt: b.scheduledAt.toISOString(),
          status: b.status,
        })),
      },
      message: 'OK',
      statusCode: 200,
    };
  }

  private resolveDateRange(period: DashboardPeriod, from?: string, to?: string) {
    const now = new Date();

    switch (period) {
      case DashboardPeriod.TODAY: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case DashboardPeriod.WEEK: {
        const dayOfWeek = now.getUTCDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
        const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset + 6, 23, 59, 59, 999));
        return { rangeFrom: monday, rangeTo: sunday };
      }
      case DashboardPeriod.MONTH: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case DashboardPeriod.LAST_MONTH: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case DashboardPeriod.CUSTOM: {
        if (!from || !to) throw new BadRequestException('from and to are required for custom period');
        return {
          rangeFrom: new Date(from + 'T00:00:00.000Z'),
          rangeTo: new Date(to + 'T23:59:59.999Z'),
        };
      }
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertServiceOwnership(userId: string, serviceId: string) {
    const profile = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const service = await this.prisma.client.serviceItem.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');

    if (service.barberId !== profile.id) throw new ForbiddenException();
  }

  private formatMe(profile: any) {
    return {
      id: profile.id,
      name: profile.user.name,
      phone: profile.user.phone,
      avatarUrl: profile.user.avatarUrl,
      bio: profile.bio,
      lat: profile.lat,
      lng: profile.lng,
      rating: profile.rating,
      totalReviews: profile.totalReviews,
      isActive: profile.isActive,
      rutTributario: profile.rutTributario ?? null,
      tipoClaveSii: profile.tipoClaveSii ?? null,
      hasSiiCredentials: !!(profile.rutTributario && profile.claveTributaria),
      services: profile.services.map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: Number(s.price),
        durationMin: s.durationMin,
        isActive: s.isActive,
      })),
    };
  }

  async findOne(id: string): Promise<BarberResponse & { reviews: ReviewResponse[] }> {
    const profile = await this.prisma.client.barberProfile.findUnique({
      where: { id },
      include: {
        user: true,
        services: {
          where: { isActive: true },
          select: { id: true, name: true, price: true, durationMin: true },
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            client: { select: { name: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!profile || !profile.isActive) {
      throw new NotFoundException('Barber not found');
    }

    return {
      id: profile.id,
      name: profile.user.name,
      phone: profile.user.phone,
      avatarUrl: profile.user.avatarUrl,
      rating: profile.rating,
      totalReviews: profile.totalReviews,
      bio: profile.bio,
      lat: profile.lat,
      lng: profile.lng,
      services: profile.services.map((s) => ({
        id: s.id,
        name: s.name,
        price: Number(s.price),
        durationMin: s.durationMin,
      })),
      reviews: profile.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        clientName: r.client.name,
        clientAvatarUrl: r.client.avatarUrl,
      })),
    };
  }
}
