import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBarberProfileDto } from './dto/update-barber-profile.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

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
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    lat?: number,
    lng?: number,
    radius: number = 10,
  ): Promise<BarberResponse[]> {
    const users = await this.prisma.client.user.findMany({
      where: {
        role: 'BARBER',
        barberProfile: { isActive: true },
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

    // Sort by distance if available, otherwise by rating
    return filtered.sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      return b.rating - a.rating;
    });
  }

  // ── Barber self-management ─────────────────────────────────────────────────

  async findMe(userId: string) {
    const profile = await this.prisma.client.barber.findUnique({
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
    const profile = await this.prisma.client.barber.findUnique({ where: { userId } });
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
      this.prisma.client.barber.update({
        where: { userId },
        data: {
          ...(dto.bio !== undefined && { bio: dto.bio }),
        },
      }),
    ]);

    return this.findMe(userId);
  }

  async createService(userId: string, dto: CreateServiceDto) {
    const profile = await this.prisma.client.barber.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const service = await this.prisma.client.service.create({
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

    const service = await this.prisma.client.service.update({
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

    await this.prisma.client.service.update({
      where: { id: serviceId },
      data: { isActive: false },
    });

    return { message: 'Servicio eliminado correctamente' };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertServiceOwnership(userId: string, serviceId: string) {
    const profile = await this.prisma.client.barber.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const service = await this.prisma.client.service.findUnique({ where: { id: serviceId } });
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
    const profile = await this.prisma.client.barber.findUnique({
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

// Haversine formula — returns distance in km between two lat/lng points
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
