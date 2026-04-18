import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBarbershopDto } from './dto/create-barbershop.dto';
import { UpdateBarbershopDto } from './dto/update-barbershop.dto';
import { AddStaffDto } from './dto/add-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';
import { DashboardPeriod } from './dto/dashboard-query.dto';
import { Role, BookingStatus, BarbershopStatus, InvitationStatus } from '../generated/prisma/enums';

@Injectable()
export class BarbershopsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateBarbershopDto) {
    const { comuna, ...rest } = dto;
    const address = comuna && rest.address
      ? `${rest.address}, ${comuna}`
      : rest.address ?? comuna ?? undefined;

    const shop = await this.prisma.client.barbershopProfile.create({
      data: {
        userId,
        ...rest,
        address,
        status: BarbershopStatus.ACTIVE,
      },
    });
    return this.formatShop(shop);
  }

  async findMe(userId: string) {
    const shops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      include: {
        staff: {
          where: { isActive: true },
          include: {
            barberProfile: {
              include: { user: { select: { name: true, avatarUrl: true } } },
            },
            compensationRules: { where: { isActive: true }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!shops.length) throw new NotFoundException('No barbershop profiles found');

    return shops.map((shop) => ({
      ...this.formatShop(shop),
      staff: shop.staff.map((s) => ({
        id: s.id,
        name: s.barberProfile.user.name,
        avatarUrl: s.barberProfile.user.avatarUrl,
        barberProfileId: s.barberProfileId,
        role: s.role,
        barberPercent: s.compensationRules[0]?.percentage ?? 60,
      })),
    }));
  }

  async update(userId: string, dto: UpdateBarbershopDto) {
    const shop = await this.prisma.client.barbershopProfile.findFirst({ where: { userId } });
    if (!shop) throw new NotFoundException('Barbershop profile not found');

    const updated = await this.prisma.client.barbershopProfile.update({
      where: { id: shop.id },
      data: { ...dto },
    });
    return this.formatShop(updated);
  }

  async findOne(id: string) {
    const shop = await this.prisma.client.barbershopProfile.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, avatarUrl: true } },
        staff: {
          where: { isActive: true },
          include: {
            barberProfile: {
              include: {
                user: { select: { name: true, avatarUrl: true } },
                services: { where: { isActive: true }, select: { id: true, name: true, price: true, durationMin: true } },
              },
            },
          },
        },
      },
    });
    if (!shop) throw new NotFoundException('Barbershop not found');

    return {
      id: shop.id,
      name: shop.name,
      description: shop.description,
      address: shop.address,
      lat: shop.lat,
      lng: shop.lng,
      phone: shop.phone,
      logoUrl: shop.logoUrl,
      coverUrl: shop.coverUrl,
      isActive: shop.isActive,
      owner: shop.user,
      staff: shop.staff.map((s) => ({
        membershipId: s.id,
        barberProfileId: s.barberProfileId,
        role: s.role,
        barber: {
          id: s.barberProfile.id,
          name: s.barberProfile.user.name,
          avatarUrl: s.barberProfile.user.avatarUrl,
          rating: s.barberProfile.rating,
          services: s.barberProfile.services.map((svc) => ({
            id: svc.id,
            name: svc.name,
            price: Number(svc.price),
            durationMin: svc.durationMin,
          })),
        },
      })),
    };
  }

  // ── Staff management ──

  async searchBarberByEmail(email: string) {
    if (!email?.trim()) throw new BadRequestException('Email is required');

    const user = await this.prisma.client.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { barberProfile: true },
    });

    if (!user || !user.barberProfile) {
      throw new NotFoundException('No se encontro ningun barbero con ese email');
    }

    return {
      barberProfileId: user.barberProfile.id,
      name: user.name,
      email: user.email,
      rating: user.barberProfile.rating,
      employmentType: user.barberProfile.employmentType,
    };
  }

  async addStaff(userId: string, dto: AddStaffDto) {
    const shop = await this.assertOwner(userId);

    let barberProfileId = dto.barberProfileId;

    // If no barberProfileId, create user + barber profile from name/rut
    if (!barberProfileId) {
      if (!dto.name?.trim()) throw new BadRequestException('name is required');
      if (!dto.rut?.trim()) throw new BadRequestException('rut is required');

      const placeholderEmail = `${dto.rut.replace(/[^0-9kK]/g, '')}@placeholder.barbergo.cl`;

      const user = await this.prisma.client.user.create({
        data: {
          name: dto.name.trim(),
          email: placeholderEmail,
          password: 'PENDING_REGISTRATION',
          role: Role.BARBER_EMPLOYEE,
        },
      });

      const barberProfile = await this.prisma.client.barberProfile.create({
        data: {
          userId: user.id,
          barbershopId: shop.id,
          employmentType: 'EMPLOYEE',
          rutTributario: dto.rut.trim(),
        },
      });

      barberProfileId = barberProfile.id;
    } else {
      // Link existing barber profile to this shop
      await this.prisma.client.barberProfile.update({
        where: { id: barberProfileId },
        data: { barbershopId: shop.id, employmentType: 'EMPLOYEE' },
      });
    }

    const membership = await this.prisma.client.barbershopStaffMembership.create({
      data: {
        barbershopId: shop.id,
        barberProfileId: barberProfileId!,
        role: dto.role ?? 'BARBER',
      },
    });

    // Set compensation if barberPercent provided
    if (dto.barberPercent != null) {
      await this.prisma.client.staffCompensationRule.create({
        data: {
          membershipId: membership.id,
          label: 'Comision barbero',
          percentage: dto.barberPercent,
          isActive: true,
        },
      });
    }

    return { membershipId: membership.id, barberProfileId, role: membership.role, name: dto.name };
  }

  async updateStaff(userId: string, memberId: string, dto: UpdateStaffDto) {
    await this.assertOwner(userId);

    if (dto.barberPercent != null && dto.shopPercent != null) {
      if (dto.barberPercent + dto.shopPercent !== 100) {
        throw new BadRequestException('barberPercent + shopPercent must equal 100');
      }
    }

    const membership = await this.prisma.client.barbershopStaffMembership.findUnique({
      where: { id: memberId },
      include: { compensationRules: { where: { isActive: true } } },
    });
    if (!membership) throw new NotFoundException('Staff membership not found');

    if (dto.isActive === false) {
      await this.prisma.client.barbershopStaffMembership.update({
        where: { id: memberId },
        data: { isActive: false },
      });
    }

    // Upsert compensation rule if percentages provided
    if (dto.barberPercent != null) {
      await this.prisma.client.staffCompensationRule.deleteMany({
        where: { membershipId: memberId },
      });
      await this.prisma.client.staffCompensationRule.create({
        data: {
          membershipId: memberId,
          label: 'Default split',
          percentage: dto.barberPercent,
        },
      });
    }

    return { message: 'Staff updated' };
  }

  async removeStaff(userId: string, memberId: string) {
    await this.assertOwner(userId);
    await this.prisma.client.barbershopStaffMembership.update({
      where: { id: memberId },
      data: { isActive: false },
    });
    return { message: 'Staff member removed' };
  }

  // ── Team ──────────────────────────────────────────────────────────────────────

  async getTeam(userId: string, scope: string, period?: DashboardPeriod) {
    const ownerShops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (ownerShops.length === 0) throw new NotFoundException('No barbershops found');

    let barbershopIds: string[];
    if (scope === 'all') {
      barbershopIds = ownerShops.map((s) => s.id);
    } else {
      const found = ownerShops.find((s) => s.id === scope);
      if (!found) throw new ForbiddenException('Barbershop not found or not owned by you');
      barbershopIds = [scope];
    }

    // Resolve period for KPIs (default to current month)
    const effectivePeriod = period ?? DashboardPeriod.MONTH;
    const { rangeFrom, rangeTo } = this.resolveDateRange(effectivePeriod);

    // Fetch active staff across selected shops
    const memberships = await this.prisma.client.barbershopStaffMembership.findMany({
      where: { barbershopId: { in: barbershopIds }, isActive: true },
      include: {
        barberProfile: {
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
        },
        barbershop: { select: { id: true, name: true } },
        compensationRules: { where: { isActive: true }, take: 1 },
      },
    });

    // Fetch completed bookings in period for these barbers
    const barberIds = memberships.map((m) => m.barberProfileId);
    const bookings = barberIds.length > 0
      ? await this.prisma.client.booking.findMany({
          where: {
            barberId: { in: barberIds },
            barbershopId: { in: barbershopIds },
            status: BookingStatus.COMPLETED,
            scheduledAt: { gte: rangeFrom, lte: rangeTo },
            deletedAt: null,
          },
          select: {
            barberId: true,
            grossAmount: true,
            barberAmount: true,
          },
        })
      : [];

    // Fetch average ratings
    const reviews = barberIds.length > 0
      ? await this.prisma.client.review.findMany({
          where: { barberId: { in: barberIds }, deletedAt: null },
          select: { barberId: true, rating: true },
        })
      : [];

    // Build per-barber KPIs
    const bookingMap = new Map<string, { count: number; gross: number; earnings: number }>();
    for (const b of bookings) {
      const entry = bookingMap.get(b.barberId) ?? { count: 0, gross: 0, earnings: 0 };
      entry.count += 1;
      entry.gross += Number(b.grossAmount);
      entry.earnings += Number(b.barberAmount);
      bookingMap.set(b.barberId, entry);
    }

    const ratingMap = new Map<string, { sum: number; count: number }>();
    for (const r of reviews) {
      const entry = ratingMap.get(r.barberId) ?? { sum: 0, count: 0 };
      entry.sum += r.rating;
      entry.count += 1;
      ratingMap.set(r.barberId, entry);
    }

    const team = memberships.map((m) => {
      const fullName = m.barberProfile.user.name ?? '';
      const parts = fullName.trim().split(/\s+/);
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : fullName.slice(0, 2).toUpperCase();

      const barberPercent = m.compensationRules[0]?.percentage ?? 60;
      const bkpi = bookingMap.get(m.barberProfileId) ?? { count: 0, gross: 0, earnings: 0 };
      const rEntry = ratingMap.get(m.barberProfileId);
      const avgRating = rEntry ? Math.round((rEntry.sum / rEntry.count) * 10) / 10 : null;

      return {
        barberId: m.barberProfileId,
        userId: m.barberProfile.userId,
        membershipId: m.id,
        name: fullName,
        avatarInitials: initials,
        avatarUrl: m.barberProfile.user.avatarUrl,
        email: m.barberProfile.user.email,
        shopId: m.barbershop.id,
        shopName: m.barbershop.name,
        barberPercent: Math.round(barberPercent),
        shopPercent: 100 - Math.round(barberPercent),
        membershipStatus: 'ACTIVE',
        kpis: {
          totalBookings: bkpi.count,
          totalGross: Math.round(bkpi.gross),
          totalEarnings: Math.round(bkpi.earnings),
          averageRating: avgRating,
        },
      };
    });

    return { data: team, message: 'OK', statusCode: 200 };
  }

  async getTeamMemberDetail(userId: string, barberId: string) {
    const ownerShops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (ownerShops.length === 0) throw new NotFoundException('No barbershops found');
    const shopIds = ownerShops.map((s) => s.id);

    const membership = await this.prisma.client.barbershopStaffMembership.findFirst({
      where: { barberProfileId: barberId, barbershopId: { in: shopIds }, isActive: true },
      include: {
        barberProfile: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true, createdAt: true } },
            services: { where: { isActive: true }, select: { id: true, name: true, price: true, durationMin: true } },
          },
        },
        barbershop: { select: { id: true, name: true } },
        compensationRules: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!membership) throw new NotFoundException('Barber not found in your barbershops');

    // Aggregate stats
    const [bookingStats, reviewStats, recentBookings] = await Promise.all([
      this.prisma.client.booking.aggregate({
        where: {
          barberId,
          barbershopId: { in: shopIds },
          status: BookingStatus.COMPLETED,
          deletedAt: null,
        },
        _count: true,
        _sum: { grossAmount: true, barberAmount: true },
      }),
      this.prisma.client.review.aggregate({
        where: { barberId, deletedAt: null },
        _avg: { rating: true },
        _count: true,
      }),
      this.prisma.client.booking.findMany({
        where: {
          barberId,
          barbershopId: { in: shopIds },
          status: BookingStatus.COMPLETED,
          deletedAt: null,
        },
        orderBy: { scheduledAt: 'desc' },
        take: 5,
        select: {
          id: true,
          scheduledAt: true,
          grossAmount: true,
          barberAmount: true,
          paymentMethod: true,
          service: { select: { name: true } },
          client: { select: { name: true } },
        },
      }),
    ]);

    const fullName = membership.barberProfile.user.name ?? '';
    const parts = fullName.trim().split(/\s+/);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : fullName.slice(0, 2).toUpperCase();

    const activeRule = membership.compensationRules.find((r) => r.isActive);

    return {
      data: {
        barberId: membership.barberProfileId,
        userId: membership.barberProfile.userId,
        membershipId: membership.id,
        name: fullName,
        avatarInitials: initials,
        avatarUrl: membership.barberProfile.user.avatarUrl,
        email: membership.barberProfile.user.email,
        phone: membership.barberProfile.user.phone,
        joinedAt: membership.joinedAt,
        shopId: membership.barbershop.id,
        shopName: membership.barbershop.name,
        barberPercent: Math.round(activeRule?.percentage ?? 60),
        shopPercent: 100 - Math.round(activeRule?.percentage ?? 60),
        services: membership.barberProfile.services.map((s) => ({
          id: s.id,
          name: s.name,
          price: Number(s.price),
          durationMin: s.durationMin,
        })),
        stats: {
          totalBookings: bookingStats._count,
          totalGross: Math.round(Number(bookingStats._sum.grossAmount ?? 0)),
          totalEarnings: Math.round(Number(bookingStats._sum.barberAmount ?? 0)),
          averageRating: reviewStats._avg.rating
            ? Math.round(reviewStats._avg.rating * 10) / 10
            : null,
          totalReviews: reviewStats._count,
        },
        recentBookings: recentBookings.map((b) => ({
          id: b.id,
          scheduledAt: b.scheduledAt,
          grossAmount: Number(b.grossAmount),
          barberAmount: Number(b.barberAmount),
          paymentMethod: b.paymentMethod,
          serviceName: b.service.name,
          clientName: b.client.name,
        })),
        compensationHistory: membership.compensationRules.map((r) => ({
          id: r.id,
          percentage: r.percentage,
          isActive: r.isActive,
          createdAt: r.createdAt,
        })),
      },
      message: 'OK',
      statusCode: 200,
    };
  }

  async updateCommission(userId: string, barberId: string, dto: UpdateCommissionDto) {
    if (dto.barberPercent + dto.shopPercent !== 100) {
      throw new BadRequestException('barberPercent + shopPercent must equal 100');
    }

    const ownerShops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (ownerShops.length === 0) throw new NotFoundException('No barbershops found');
    const shopIds = ownerShops.map((s) => s.id);

    const membership = await this.prisma.client.barbershopStaffMembership.findFirst({
      where: { barberProfileId: barberId, barbershopId: { in: shopIds }, isActive: true },
    });
    if (!membership) throw new NotFoundException('Barber not found in your barbershops');

    // Deactivate old rules (preserve history)
    await this.prisma.client.staffCompensationRule.updateMany({
      where: { membershipId: membership.id, isActive: true },
      data: { isActive: false },
    });

    // Create new active rule
    const rule = await this.prisma.client.staffCompensationRule.create({
      data: {
        membershipId: membership.id,
        label: 'Comision barbero',
        percentage: dto.barberPercent,
        isActive: true,
      },
    });

    return {
      data: {
        membershipId: membership.id,
        barberPercent: dto.barberPercent,
        shopPercent: dto.shopPercent,
        ruleId: rule.id,
        effectiveFrom: rule.createdAt,
      },
      message: 'Commission updated',
      statusCode: 200,
    };
  }

  async createInvitation(userId: string, dto: CreateInvitationDto) {
    // Validate ownership
    const shop = await this.prisma.client.barbershopProfile.findFirst({
      where: { id: dto.barbershopId, userId, deletedAt: null },
    });
    if (!shop) throw new ForbiddenException('Barbershop not found or not owned by you');

    // Validate percentages
    const barberPct = dto.barberPercent ?? 60;
    const shopPct = dto.shopPercent ?? 40;
    if (barberPct + shopPct !== 100) {
      throw new BadRequestException('barberPercent + shopPercent must equal 100');
    }

    // Check for existing pending invitation with same email (if provided)
    if (dto.email) {
      const existing = await this.prisma.client.barberInvitation.findFirst({
        where: {
          barbershopId: dto.barbershopId,
          email: dto.email.toLowerCase(),
          status: InvitationStatus.PENDING,
          expiresAt: { gt: new Date() },
        },
      });
      if (existing) {
        throw new ConflictException('Already exists a pending invitation for this email');
      }
    }

    // Generate 6-digit code
    const code = this.generateInvitationCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.prisma.client.barberInvitation.create({
      data: {
        code,
        barbershopId: dto.barbershopId,
        invitedByUserId: userId,
        initialBarberPercent: barberPct,
        initialShopPercent: shopPct,
        email: dto.email?.toLowerCase(),
        expiresAt,
      },
    });

    return {
      data: {
        id: invitation.id,
        code: invitation.code,
        barbershopId: invitation.barbershopId,
        barbershopName: shop.name,
        barberPercent: invitation.initialBarberPercent,
        shopPercent: invitation.initialShopPercent,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        status: invitation.status,
      },
      message: 'Invitation created',
      statusCode: 201,
    };
  }

  async getInvitations(userId: string, barbershopId?: string) {
    const ownerShops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (ownerShops.length === 0) throw new NotFoundException('No barbershops found');
    const shopIds = barbershopId
      ? [barbershopId]
      : ownerShops.map((s) => s.id);

    if (barbershopId && !ownerShops.find((s) => s.id === barbershopId)) {
      throw new ForbiddenException('Barbershop not found or not owned by you');
    }

    const shopMap = new Map(ownerShops.map((s) => [s.id, s.name]));

    const invitations = await this.prisma.client.barberInvitation.findMany({
      where: { barbershopId: { in: shopIds } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: invitations.map((inv) => ({
        id: inv.id,
        code: inv.code,
        barbershopId: inv.barbershopId,
        barbershopName: shopMap.get(inv.barbershopId) ?? '',
        barberPercent: inv.initialBarberPercent,
        shopPercent: inv.initialShopPercent,
        email: inv.email,
        status: inv.expiresAt < new Date() && inv.status === 'PENDING' ? 'EXPIRED' : inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      })),
      message: 'OK',
      statusCode: 200,
    };
  }

  async revokeInvitation(userId: string, invitationId: string) {
    const invitation = await this.prisma.client.barberInvitation.findUnique({
      where: { id: invitationId },
      include: { barbershop: { select: { userId: true } } },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.barbershop.userId !== userId) {
      throw new ForbiddenException('Not your invitation');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Only pending invitations can be revoked');
    }

    await this.prisma.client.barberInvitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });

    return { message: 'Invitation revoked', statusCode: 200 };
  }

  async removeTeamMember(userId: string, barberId: string) {
    const ownerShops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (ownerShops.length === 0) throw new NotFoundException('No barbershops found');
    const shopIds = ownerShops.map((s) => s.id);

    const membership = await this.prisma.client.barbershopStaffMembership.findFirst({
      where: { barberProfileId: barberId, barbershopId: { in: shopIds }, isActive: true },
    });
    if (!membership) throw new NotFoundException('Barber not found in your barbershops');

    // Soft deactivate membership
    await this.prisma.client.barbershopStaffMembership.update({
      where: { id: membership.id },
      data: { isActive: false },
    });

    // Remove barbershop link from barber profile
    await this.prisma.client.barberProfile.update({
      where: { id: barberId },
      data: { barbershopId: null },
    });

    return { message: 'Barber removed from team', statusCode: 200 };
  }

  private generateInvitationCode(): string {
    const chars = '0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // ── Invite code ──

  async getOrCreateInviteCode(userId: string) {
    const shop = await this.assertOwner(userId);

    if (shop.inviteCode) {
      return { inviteCode: shop.inviteCode };
    }

    // Generate a unique 8-char alphanumeric code
    const code = this.generateCode();
    await this.prisma.client.barbershopProfile.update({
      where: { id: shop.id },
      data: { inviteCode: code },
    });

    return { inviteCode: code };
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // ── Helpers ──

  private async assertOwner(userId: string) {
    const shop = await this.prisma.client.barbershopProfile.findFirst({ where: { userId } });
    if (!shop) throw new NotFoundException('Barbershop profile not found');
    return shop;
  }

  private formatShop(shop: any) {
    return {
      id: shop.id,
      name: shop.name,
      description: shop.description,
      address: shop.address,
      lat: shop.lat,
      lng: shop.lng,
      phone: shop.phone,
      logoUrl: shop.logoUrl,
      coverUrl: shop.coverUrl,
      isActive: shop.isActive,
    };
  }

  // ── Schedule ──────────────────────────────────────────────────────────────

  async getSchedule(userId: string) {
    const shop = await this.prisma.client.barbershopProfile.findFirst({ where: { userId } });
    if (!shop) throw new NotFoundException('Barbershop not found');
    return { schedule: shop.scheduleJson ? JSON.parse(shop.scheduleJson) : {} };
  }

  async updateSchedule(userId: string, schedule: Record<string, { start: string; end: string }[]>) {
    const shop = await this.prisma.client.barbershopProfile.findFirst({ where: { userId } });
    if (!shop) throw new NotFoundException('Barbershop not found');
    await this.prisma.client.barbershopProfile.update({
      where: { id: shop.id },
      data: { scheduleJson: JSON.stringify(schedule) },
    });
    return { schedule };
  }

  async updateStaffAvailability(
    userId: string,
    barberId: string,
    slots: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[],
  ) {
    const shop = await this.prisma.client.barbershopProfile.findFirst({ where: { userId } });
    if (!shop) throw new NotFoundException('Barbershop not found');

    // Verify barber belongs to this shop
    const membership = await this.prisma.client.barbershopStaffMembership.findFirst({
      where: { barbershopId: shop.id, barberProfileId: barberId },
    });
    if (!membership) throw new NotFoundException('Barber not in this barbershop');

    // Delete all existing and recreate (supports multiple blocks per day)
    await this.prisma.client.weeklyAvailability.deleteMany({ where: { barberId } });

    if (slots.length > 0) {
      await this.prisma.client.weeklyAvailability.createMany({
        data: slots.map((slot) => ({
          barberId,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          isActive: slot.isActive,
        })),
      });
    }

    return { success: true };
  }

  // ── Owner Dashboard ─────────────────────────────────────────────────────────

  async getDashboard(userId: string, scope: string, period: DashboardPeriod, year?: number) {
    // 1. Resolve scope → barbershopIds
    const ownerShops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true, address: true },
    });
    if (ownerShops.length === 0) throw new NotFoundException('No barbershops found');

    let barbershopIds: string[];
    if (scope === 'all') {
      barbershopIds = ownerShops.map((s) => s.id);
    } else {
      const found = ownerShops.find((s) => s.id === scope);
      if (!found) throw new ForbiddenException('Barbershop not found or not owned by you');
      barbershopIds = [scope];
    }

    // 2. Resolve period
    const { rangeFrom, rangeTo } = this.resolveDateRange(period, year);

    // 3. Query completed bookings in range
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        barbershopId: { in: barbershopIds },
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: rangeFrom, lte: rangeTo },
        deletedAt: null,
      },
      select: {
        grossAmount: true,
        platformFee: true,
        barberAmount: true,
        shopAmount: true,
        paymentMethod: true,
        scheduledAt: true,
        barberId: true,
        barbershopId: true,
        barber: {
          select: {
            id: true,
            user: { select: { name: true } },
            staffMemberships: {
              where: { barbershopId: { in: barbershopIds }, isActive: true },
              select: { barbershop: { select: { id: true, name: true } } },
              take: 1,
            },
          },
        },
      },
    });

    // 4. Compute KPIs
    let totalGross = 0;
    let platformFee = 0;
    let paidToBarbers = 0;
    for (const b of bookings) {
      totalGross += Number(b.grossAmount);
      platformFee += Number(b.platformFee);
      paidToBarbers += Number(b.barberAmount);
    }
    const netProfit = totalGross - platformFee - paidToBarbers;
    const totalBookings = bookings.length;

    // 5. Comparison vs previous period
    const prevRange = this.resolvePreviousRange(period, year);
    const prevBookings = await this.prisma.client.booking.findMany({
      where: {
        barbershopId: { in: barbershopIds },
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: prevRange.rangeFrom, lte: prevRange.rangeTo },
        deletedAt: null,
      },
      select: { grossAmount: true, platformFee: true, barberAmount: true },
    });

    let prevGross = 0;
    let prevPlatformFee = 0;
    let prevPaidToBarbers = 0;
    for (const b of prevBookings) {
      prevGross += Number(b.grossAmount);
      prevPlatformFee += Number(b.platformFee);
      prevPaidToBarbers += Number(b.barberAmount);
    }
    const prevNet = prevGross - prevPlatformFee - prevPaidToBarbers;
    const prevTotal = prevBookings.length;

    const pct = (curr: number, prev: number): number | null => {
      if (prev === 0) return null;
      return Math.round(((curr - prev) / prev) * 1000) / 10;
    };

    // 6. Income by day
    const dayMap = new Map<string, { gross: number; net: number; bookings: number }>();
    const cursor = new Date(rangeFrom);
    while (cursor <= rangeTo) {
      dayMap.set(cursor.toISOString().slice(0, 10), { gross: 0, net: 0, bookings: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    for (const b of bookings) {
      const day = b.scheduledAt.toISOString().slice(0, 10);
      const entry = dayMap.get(day);
      if (entry) {
        const g = Number(b.grossAmount);
        const pf = Number(b.platformFee);
        const ba = Number(b.barberAmount);
        entry.gross += g;
        entry.net += g - pf - ba;
        entry.bookings += 1;
      }
    }
    const incomeByDay = [...dayMap.entries()].map(([date, v]) => ({
      date,
      gross: Math.round(v.gross),
      net: Math.round(v.net),
      bookings: v.bookings,
    }));

    // 7. Peak hours (bookings grouped by hour of day)
    const hourMap = new Map<number, { count: number; revenue: number }>();
    for (let h = 9; h <= 21; h++) {
      hourMap.set(h, { count: 0, revenue: 0 });
    }
    for (const b of bookings) {
      const hour = b.scheduledAt.getHours();
      if (hour >= 9 && hour <= 21) {
        const acc = hourMap.get(hour)!;
        acc.count += 1;
        acc.revenue += Number(b.grossAmount);
      }
    }
    const peakHours = [...hourMap.entries()].map(([hour, data]) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      count: data.count,
      revenue: Math.round(data.revenue),
    }));

    // 8. Shop distribution (only if scope === 'all')
    let shopDistribution: {
      shopId: string;
      name: string;
      address: string | null;
      amount: number;
      bookings: number;
      shopProfit: number;
    }[] | undefined;

    if (scope === 'all') {
      const shopMap = new Map<string, { amount: number; bookings: number; shopProfit: number }>();
      for (const s of ownerShops) {
        shopMap.set(s.id, { amount: 0, bookings: 0, shopProfit: 0 });
      }
      for (const b of bookings) {
        if (b.barbershopId) {
          const entry = shopMap.get(b.barbershopId);
          if (entry) {
            entry.amount += Number(b.grossAmount);
            entry.bookings += 1;
            entry.shopProfit += Number(b.shopAmount);
          }
        }
      }
      shopDistribution = ownerShops.map((s) => {
        const data = shopMap.get(s.id)!;
        return {
          shopId: s.id,
          name: s.name,
          address: s.address,
          amount: Math.round(data.amount),
          bookings: data.bookings,
          shopProfit: Math.round(data.shopProfit),
        };
      });
    }

    // 8. Payment method distribution
    const pmDist: Record<string, { count: number; amount: number }> = {
      IN_APP: { count: 0, amount: 0 },
      CASH: { count: 0, amount: 0 },
    };
    for (const b of bookings) {
      const key = b.paymentMethod === 'CASH' ? 'CASH' : 'IN_APP';
      pmDist[key].count += 1;
      pmDist[key].amount += Number(b.grossAmount);
    }
    pmDist.IN_APP.amount = Math.round(pmDist.IN_APP.amount);
    pmDist.CASH.amount = Math.round(pmDist.CASH.amount);

    // 9. Top barbers
    const barberMap = new Map<string, {
      barberId: string;
      name: string;
      avatarInitials: string;
      shopName: string;
      shopId: string;
      bookingsCount: number;
      totalGross: number;
      paidToBarber: number;
    }>();
    for (const b of bookings) {
      if (!barberMap.has(b.barberId)) {
        const fullName = b.barber.user.name ?? '';
        const parts = fullName.trim().split(/\s+/);
        const initials = parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : fullName.slice(0, 2).toUpperCase();
        const membership = b.barber.staffMemberships[0];
        barberMap.set(b.barberId, {
          barberId: b.barberId,
          name: fullName,
          avatarInitials: initials,
          shopName: membership?.barbershop.name ?? '',
          shopId: membership?.barbershop.id ?? '',
          bookingsCount: 0,
          totalGross: 0,
          paidToBarber: 0,
        });
      }
      const entry = barberMap.get(b.barberId)!;
      entry.bookingsCount += 1;
      entry.totalGross += Number(b.grossAmount);
      entry.paidToBarber += Number(b.barberAmount);
    }
    const topBarbers = [...barberMap.values()]
      .sort((a, b) => b.totalGross - a.totalGross)
      .slice(0, 10)
      .map((t) => ({
        ...t,
        totalGross: Math.round(t.totalGross),
        paidToBarber: Math.round(t.paidToBarber),
      }));

    // 10. Operational KPIs
    const avgTicket = totalBookings > 0 ? Math.round(totalGross / totalBookings) : 0;
    const totalPm = pmDist.CASH.count + pmDist.IN_APP.count;
    const cashVsInAppRatio = totalPm > 0
      ? {
          cash: Math.round((pmDist.CASH.count / totalPm) * 1000) / 10,
          inApp: Math.round((pmDist.IN_APP.count / totalPm) * 1000) / 10,
        }
      : { cash: 0, inApp: 0 };

    // 11. Revenue growth (month-by-month for the year)
    const growthYear = year ?? new Date().getUTCFullYear();
    const growthFrom = new Date(Date.UTC(growthYear, 0, 1));
    const growthTo = new Date(Date.UTC(growthYear, 11, 31, 23, 59, 59, 999));
    const growthBookings = await this.prisma.client.booking.findMany({
      where: {
        barbershopId: { in: barbershopIds },
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: growthFrom, lte: growthTo },
        deletedAt: null,
      },
      select: { grossAmount: true, scheduledAt: true },
    });

    const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const nowUtc = new Date();
    const currentMonth = nowUtc.getUTCFullYear() === growthYear ? nowUtc.getUTCMonth() : 11;

    const monthlyRevenue: number[] = Array(12).fill(0);
    const monthlyBookings: number[] = Array(12).fill(0);
    for (const b of growthBookings) {
      const m = b.scheduledAt.getUTCMonth();
      monthlyRevenue[m] += Number(b.grossAmount);
      monthlyBookings[m] += 1;
    }

    const revenueGrowth = MONTH_LABELS.map((label, i) => {
      const isFuture = i > currentMonth;
      const revenue = isFuture ? 0 : Math.round(monthlyRevenue[i]);
      const bkgs = isFuture ? 0 : monthlyBookings[i];
      let growthPct: number | null = null;
      if (!isFuture && i > 0 && monthlyRevenue[i - 1] > 0) {
        growthPct = Math.round(((monthlyRevenue[i] - monthlyRevenue[i - 1]) / monthlyRevenue[i - 1]) * 1000) / 10;
      }
      return { month: label, monthNumber: i + 1, revenue, bookings: bkgs, growthPct };
    });

    return {
      data: {
        scope,
        barbershopsCount: ownerShops.length,
        period: {
          type: period,
          from: rangeFrom.toISOString().slice(0, 10),
          to: rangeTo.toISOString().slice(0, 10),
        },
        kpis: {
          totalGross: Math.round(totalGross),
          platformFee: Math.round(platformFee),
          paidToBarbers: Math.round(paidToBarbers),
          netProfit: Math.round(netProfit),
          totalBookings,
          comparison: {
            totalGrossPct: pct(totalGross, prevGross),
            netProfitPct: pct(netProfit, prevNet),
            totalBookingsPct: pct(totalBookings, prevTotal),
          },
        },
        incomeByDay,
        peakHours,
        ...(shopDistribution ? { shopDistribution } : {}),
        paymentMethodDistribution: pmDist,
        topBarbers,
        operationalKpis: {
          avgTicket,
          cashVsInAppRatio,
        },
        revenueGrowth,
      },
      message: 'OK',
      statusCode: 200,
    };
  }

  // ── Date range helpers ──────────────────────────────────────────────────────

  private resolveDateRange(period: DashboardPeriod, year?: number) {
    const now = new Date();
    const isCurrentYear = !year || year === now.getUTCFullYear();

    if (!isCurrentYear) {
      // For past years, map periods relative to that year using current month context
      const m = now.getUTCMonth();
      switch (period) {
        case DashboardPeriod.TODAY: {
          // Same day in the past year
          const rangeFrom = new Date(Date.UTC(year, m, now.getUTCDate()));
          const rangeTo = new Date(Date.UTC(year, m, now.getUTCDate(), 23, 59, 59, 999));
          return { rangeFrom, rangeTo };
        }
        case DashboardPeriod.WEEK: {
          // Last 7 days of the same week context
          const ref = new Date(Date.UTC(year, m, now.getUTCDate()));
          const dayOfWeek = ref.getUTCDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          const monday = new Date(Date.UTC(year, m, ref.getUTCDate() + mondayOffset));
          const sunday = new Date(Date.UTC(year, m, ref.getUTCDate() + mondayOffset + 6, 23, 59, 59, 999));
          return { rangeFrom: monday, rangeTo: sunday };
        }
        case DashboardPeriod.MONTH: {
          const rangeFrom = new Date(Date.UTC(year, m, 1));
          const rangeTo = new Date(Date.UTC(year, m + 1, 0, 23, 59, 59, 999));
          return { rangeFrom, rangeTo };
        }
        case DashboardPeriod.LAST_MONTH: {
          const rangeFrom = new Date(Date.UTC(year, m - 1, 1));
          const rangeTo = new Date(Date.UTC(year, m, 0, 23, 59, 59, 999));
          return { rangeFrom, rangeTo };
        }
      }
    }

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
    }
  }

  private resolvePreviousRange(period: DashboardPeriod, year?: number) {
    const now = new Date();
    const isCurrentYear = !year || year === now.getUTCFullYear();
    const refYear = year ?? now.getUTCFullYear();
    const m = now.getUTCMonth();

    if (!isCurrentYear) {
      switch (period) {
        case DashboardPeriod.TODAY: {
          const d = new Date(Date.UTC(refYear, m, now.getUTCDate() - 1));
          return { rangeFrom: d, rangeTo: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)) };
        }
        case DashboardPeriod.WEEK: {
          const ref = new Date(Date.UTC(refYear, m, now.getUTCDate()));
          const dayOfWeek = ref.getUTCDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          const prevMonday = new Date(Date.UTC(refYear, m, ref.getUTCDate() + mondayOffset - 7));
          const prevSunday = new Date(Date.UTC(refYear, m, ref.getUTCDate() + mondayOffset - 1, 23, 59, 59, 999));
          return { rangeFrom: prevMonday, rangeTo: prevSunday };
        }
        case DashboardPeriod.MONTH: {
          const rangeFrom = new Date(Date.UTC(refYear, m - 1, 1));
          const rangeTo = new Date(Date.UTC(refYear, m, 0, 23, 59, 59, 999));
          return { rangeFrom, rangeTo };
        }
        case DashboardPeriod.LAST_MONTH: {
          const rangeFrom = new Date(Date.UTC(refYear, m - 2, 1));
          const rangeTo = new Date(Date.UTC(refYear, m - 1, 0, 23, 59, 59, 999));
          return { rangeFrom, rangeTo };
        }
      }
    }

    switch (period) {
      case DashboardPeriod.TODAY: {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
        return {
          rangeFrom: d,
          rangeTo: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)),
        };
      }
      case DashboardPeriod.WEEK: {
        const dayOfWeek = now.getUTCDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const prevMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset - 7));
        const prevSunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset - 1, 23, 59, 59, 999));
        return { rangeFrom: prevMonday, rangeTo: prevSunday };
      }
      case DashboardPeriod.MONTH: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
      case DashboardPeriod.LAST_MONTH: {
        const rangeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
        const rangeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 0, 23, 59, 59, 999));
        return { rangeFrom, rangeTo };
      }
    }
  }
}
