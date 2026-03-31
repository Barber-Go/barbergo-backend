import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilitySlotDto } from './dto/upsert-availability.dto';

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async findByBarberId(barberId: string) {
    const rows = await this.prisma.client.availability.findMany({
      where: { barberId },
      orderBy: { dayOfWeek: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      isActive: r.isActive,
    }));
  }

  async upsertForBarber(userId: string, slots: AvailabilitySlotDto[]) {
    const barber = await this.prisma.client.barber.findUnique({
      where: { userId },
    });
    if (!barber) throw new NotFoundException('Barber profile not found');

    // Upsert each slot by (barberId, dayOfWeek) unique constraint
    for (const slot of slots) {
      await this.prisma.client.availability.upsert({
        where: {
          barberId_dayOfWeek: {
            barberId: barber.id,
            dayOfWeek: slot.dayOfWeek,
          },
        },
        create: {
          barberId: barber.id,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          isActive: slot.isActive,
        },
        update: {
          startTime: slot.startTime,
          endTime: slot.endTime,
          isActive: slot.isActive,
        },
      });
    }

    return this.findByBarberId(barber.id);
  }
}
