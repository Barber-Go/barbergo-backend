import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilitySlotDto } from './dto/upsert-availability.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { BookingStatus } from '../generated/prisma/enums';

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async findByBarberId(barberId: string) {
    const rows = await this.prisma.client.weeklyAvailability.findMany({
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
    const barber = await this.prisma.client.barberProfile.findUnique({
      where: { userId },
    });
    if (!barber) throw new NotFoundException('Barber profile not found');

    // Delete all existing and recreate (supports multiple blocks per day)
    await this.prisma.client.weeklyAvailability.deleteMany({
      where: { barberId: barber.id },
    });

    if (slots.length > 0) {
      await this.prisma.client.weeklyAvailability.createMany({
        data: slots.map((slot) => ({
          barberId: barber.id,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          isActive: slot.isActive,
        })),
      });
    }

    return this.findByBarberId(barber.id);
  }

  // ── Month bookable dates ────────────────────────────────────────────────────

  async getBookableDates(barberId: string, year: number, month: number) {
    const weekly = await this.prisma.client.weeklyAvailability.findMany({
      where: { barberId, isActive: true },
    });
    if (weekly.length === 0) return [];

    const activeDays = new Set(weekly.map((w) => w.dayOfWeek));
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);

    const blocks = await this.prisma.client.availabilityBlock.findMany({
      where: { barberId, startAt: { lte: endOfMonth }, endAt: { gte: startOfMonth } },
    });

    const dates: string[] = [];
    const cursor = new Date(startOfMonth);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    while (cursor <= endOfMonth) {
      if (cursor >= today && activeDays.has(cursor.getDay())) {
        const dayStart = new Date(cursor);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(cursor);
        dayEnd.setHours(23, 59, 59, 999);

        const fullyBlocked = blocks.some(
          (b) => b.startAt <= dayStart && b.endAt >= dayEnd,
        );

        if (!fullyBlocked) {
          dates.push(cursor.toISOString().slice(0, 10));
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
  }

  // ── Day slots ───────────────────────────────────────────────────────────────

  async getSlots(barberId: string, dateStr: string) {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();

    const weeklyBlocks = await this.prisma.client.weeklyAvailability.findMany({
      where: { barberId, dayOfWeek, isActive: true },
    });
    if (weeklyBlocks.length === 0) return [];

    // Fetch blocks and bookings for this day
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const [blocks, bookings] = await Promise.all([
      this.prisma.client.availabilityBlock.findMany({
        where: { barberId, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      }),
      this.prisma.client.booking.findMany({
        where: {
          barberId,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledAt: { gte: dayStart, lt: dayEnd },
        },
        include: { service: { select: { durationMin: true } } },
      }),
    ]);

    // Generate 30-min slots from all weekly blocks for this day
    const slots: string[] = [];
    for (const wb of weeklyBlocks) {
      const [sh, sm] = wb.startTime.split(':').map(Number);
      const [eh, em] = wb.endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;

      for (let m = startMin; m < endMin; m += 30) {
        const slotStart = new Date(date);
        slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

        const blockedByBlock = blocks.some((b) => b.startAt < slotEnd && b.endAt > slotStart);
        const blockedByBooking = bookings.some((b) => {
          const bStart = new Date(b.scheduledAt);
          const bEnd = new Date(bStart.getTime() + b.service.durationMin * 60 * 1000);
          return bStart < slotEnd && bEnd > slotStart;
        });

        if (!blockedByBlock && !blockedByBooking) {
          const hh = String(Math.floor(m / 60)).padStart(2, '0');
          const mm = String(m % 60).padStart(2, '0');
          slots.push(`${hh}:${mm}`);
        }
      }
    }

    // Deduplicate and sort
    return [...new Set(slots)].sort();
  }

  // ── Availability blocks CRUD ────────────────────────────────────────────────

  async createBlock(userId: string, dto: CreateBlockDto) {
    const profile = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const block = await this.prisma.client.availabilityBlock.create({
      data: {
        barberId: profile.id,
        type: dto.type,
        label: dto.label,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
      },
    });

    return {
      id: block.id,
      type: block.type,
      label: block.label,
      startAt: block.startAt.toISOString(),
      endAt: block.endAt.toISOString(),
    };
  }

  async deleteBlock(userId: string, blockId: string) {
    const profile = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const block = await this.prisma.client.availabilityBlock.findUnique({ where: { id: blockId } });
    if (!block) throw new NotFoundException('Block not found');
    if (block.barberId !== profile.id) throw new ForbiddenException();

    await this.prisma.client.availabilityBlock.delete({ where: { id: blockId } });
    return { message: 'Block deleted' };
  }
}
