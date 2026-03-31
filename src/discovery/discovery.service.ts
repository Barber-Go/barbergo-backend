import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchQueryDto, ViewportQueryDto } from './dto/search-query.dto';
import { PublicEntityType, BarberEmploymentType } from '../generated/prisma/enums';
import { haversineKm } from '../shared/geo.utils';

export interface DiscoveryResult {
  entityType: PublicEntityType;
  id: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  lat: number | null;
  lng: number | null;
  distance?: number;
  action: string;
  services: { id: string; name: string; price: number; durationMin: number }[];
}

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: SearchQueryDto): Promise<DiscoveryResult[]> {
    const results: DiscoveryResult[] = [];
    const radius = q.radius ?? 10;

    // Independent barbers
    if (!q.type || q.type === PublicEntityType.INDEPENDENT_BARBER) {
      const barbers = await this.prisma.client.barberProfile.findMany({
        where: {
          isActive: true,
          employmentType: BarberEmploymentType.INDEPENDENT,
        },
        include: {
          user: { select: { name: true, avatarUrl: true } },
          services: {
            where: { isActive: true },
            select: { id: true, name: true, price: true, durationMin: true },
          },
        },
      });

      for (const b of barbers) {
        if (q.service && !b.services.some((s) => s.name.toLowerCase().includes(q.service!.toLowerCase()))) continue;

        const distance =
          q.lat != null && q.lng != null && b.lat != null && b.lng != null
            ? haversineKm(q.lat, q.lng, b.lat, b.lng)
            : undefined;

        if (distance != null && distance > radius) continue;

        results.push({
          entityType: PublicEntityType.INDEPENDENT_BARBER,
          id: b.id,
          displayName: b.user.name,
          avatarUrl: b.user.avatarUrl,
          rating: b.rating,
          lat: b.lat,
          lng: b.lng,
          distance,
          action: 'OPEN_INDEPENDENT_BARBER_PROFILE',
          services: b.services.map((s) => ({ id: s.id, name: s.name, price: Number(s.price), durationMin: s.durationMin })),
        });
      }
    }

    // Barbershops
    if (!q.type || q.type === PublicEntityType.BARBERSHOP) {
      const shops = await this.prisma.client.barbershopProfile.findMany({
        where: { isActive: true },
        include: { user: { select: { name: true, avatarUrl: true } } },
      });

      for (const s of shops) {
        const distance =
          q.lat != null && q.lng != null && s.lat != null && s.lng != null
            ? haversineKm(q.lat, q.lng, s.lat, s.lng)
            : undefined;

        if (distance != null && distance > radius) continue;

        results.push({
          entityType: PublicEntityType.BARBERSHOP,
          id: s.id,
          displayName: s.name,
          avatarUrl: s.logoUrl,
          rating: 0,
          lat: s.lat,
          lng: s.lng,
          distance,
          action: 'OPEN_BARBERSHOP_PROFILE',
          services: [],
        });
      }
    }

    // Sort by distance if available, else by rating desc
    return results.sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      return b.rating - a.rating;
    });
  }

  async viewport(q: ViewportQueryDto): Promise<DiscoveryResult[]> {
    const results: DiscoveryResult[] = [];
    const latFilter = { gte: q.minLat, lte: q.maxLat };
    const lngFilter = { gte: q.minLng, lte: q.maxLng };

    if (!q.type || q.type === PublicEntityType.INDEPENDENT_BARBER) {
      const barbers = await this.prisma.client.barberProfile.findMany({
        where: { isActive: true, employmentType: BarberEmploymentType.INDEPENDENT, lat: latFilter, lng: lngFilter },
        include: {
          user: { select: { name: true, avatarUrl: true } },
          services: { where: { isActive: true }, select: { id: true, name: true, price: true, durationMin: true } },
        },
      });

      for (const b of barbers) {
        results.push({
          entityType: PublicEntityType.INDEPENDENT_BARBER,
          id: b.id,
          displayName: b.user.name,
          avatarUrl: b.user.avatarUrl,
          rating: b.rating,
          lat: b.lat,
          lng: b.lng,
          action: 'OPEN_INDEPENDENT_BARBER_PROFILE',
          services: b.services.map((s) => ({ id: s.id, name: s.name, price: Number(s.price), durationMin: s.durationMin })),
        });
      }
    }

    if (!q.type || q.type === PublicEntityType.BARBERSHOP) {
      const shops = await this.prisma.client.barbershopProfile.findMany({
        where: { isActive: true, lat: latFilter, lng: lngFilter },
      });

      for (const s of shops) {
        results.push({
          entityType: PublicEntityType.BARBERSHOP,
          id: s.id,
          displayName: s.name,
          avatarUrl: s.logoUrl,
          rating: 0,
          lat: s.lat,
          lng: s.lng,
          action: 'OPEN_BARBERSHOP_PROFILE',
          services: [],
        });
      }
    }

    return results;
  }
}
