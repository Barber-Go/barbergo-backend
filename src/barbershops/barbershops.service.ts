import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBarbershopDto } from './dto/create-barbershop.dto';
import { UpdateBarbershopDto } from './dto/update-barbershop.dto';
import { AddStaffDto } from './dto/add-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class BarbershopsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateBarbershopDto) {
    const shop = await this.prisma.client.barbershopProfile.create({
      data: { userId, ...dto },
    });
    return this.formatShop(shop);
  }

  async findMe(userId: string) {
    const shop = await this.prisma.client.barbershopProfile.findUnique({
      where: { userId },
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
    });
    if (!shop) throw new NotFoundException('Barbershop profile not found');

    return {
      ...this.formatShop(shop),
      staff: shop.staff.map((s) => ({
        id: s.id,
        name: s.barberProfile.user.name,
        avatarUrl: s.barberProfile.user.avatarUrl,
        barberProfileId: s.barberProfileId,
        role: s.role,
        barberPercent: s.compensationRules[0]?.percentage ?? 60,
      })),
    };
  }

  async update(userId: string, dto: UpdateBarbershopDto) {
    const shop = await this.prisma.client.barbershopProfile.findUnique({ where: { userId } });
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

  async addStaff(userId: string, dto: AddStaffDto) {
    const shop = await this.assertOwner(userId);

    const membership = await this.prisma.client.barbershopStaffMembership.create({
      data: {
        barbershopId: shop.id,
        barberProfileId: dto.barberProfileId,
        role: dto.role ?? 'BARBER',
      },
    });

    // Link barber profile to this shop
    await this.prisma.client.barberProfile.update({
      where: { id: dto.barberProfileId },
      data: { barbershopId: shop.id, employmentType: 'EMPLOYEE' },
    });

    return { membershipId: membership.id, barberProfileId: membership.barberProfileId, role: membership.role };
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
    const shop = await this.prisma.client.barbershopProfile.findUnique({ where: { userId } });
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
}
