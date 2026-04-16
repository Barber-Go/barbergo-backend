import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateManualBookingDto } from './dto/create-manual-booking.dto';
import { BookingStatus } from '../generated/prisma/enums';

@Injectable()
export class ManualBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateManualBookingDto) {
    const barber = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!barber) throw new NotFoundException('Barber profile not found');

    const date = new Date(dto.date);

    // Check overlap with existing manual bookings
    const existing = await this.prisma.client.manualBooking.findMany({
      where: { barberId: barber.id, date },
    });
    for (const mb of existing) {
      if (dto.startTime < mb.endTime && dto.endTime > mb.startTime) {
        throw new BadRequestException('Horario se solapa con otra cita manual');
      }
    }

    // Check overlap with app bookings
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        barberId: barber.id,
        scheduledAt: { gte: dayStart, lte: dayEnd },
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
    });
    for (const b of bookings) {
      const bTime = `${String(b.scheduledAt.getHours()).padStart(2, '0')}:${String(b.scheduledAt.getMinutes()).padStart(2, '0')}`;
      if (dto.startTime <= bTime && dto.endTime > bTime) {
        throw new BadRequestException('Horario se solapa con una reserva existente');
      }
    }

    return this.prisma.client.manualBooking.create({
      data: {
        barberId: barber.id,
        clientName: dto.clientName,
        serviceName: dto.serviceName,
        date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        note: dto.note,
        paymentMethod: dto.paymentMethod ?? 'EXTERNAL',
      },
    });
  }

  async findByDate(userId: string, dateStr: string) {
    const barber = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!barber) throw new NotFoundException('Barber profile not found');

    const date = new Date(dateStr);
    return this.prisma.client.manualBooking.findMany({
      where: { barberId: barber.id, date },
      orderBy: { startTime: 'asc' },
    });
  }

  async update(userId: string, id: string, dto: Partial<CreateManualBookingDto>) {
    const mb = await this.prisma.client.manualBooking.findUnique({
      where: { id },
      include: { barber: { select: { userId: true } } },
    });
    if (!mb) throw new NotFoundException('Manual booking not found');
    if (mb.barber.userId !== userId) throw new ForbiddenException('Not your booking');

    return this.prisma.client.manualBooking.update({
      where: { id },
      data: {
        ...(dto.clientName !== undefined && { clientName: dto.clientName }),
        ...(dto.serviceName !== undefined && { serviceName: dto.serviceName }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
        ...(dto.note !== undefined && { note: dto.note }),
        ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod }),
      },
    });
  }

  async remove(userId: string, id: string) {
    const mb = await this.prisma.client.manualBooking.findUnique({
      where: { id },
      include: { barber: { select: { userId: true } } },
    });
    if (!mb) throw new NotFoundException('Manual booking not found');
    if (mb.barber.userId !== userId) throw new ForbiddenException('Not your booking');

    await this.prisma.client.manualBooking.delete({ where: { id } });
    return { success: true };
  }

  // ── Agenda ────────────────────────────────────────────────────────────────

  async getDayAgenda(barberId: string, dateStr: string) {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();

    // 1. Weekly template
    const weekly = await this.prisma.client.weeklyAvailability.findFirst({
      where: { barberId, dayOfWeek, isActive: true },
    });

    if (!weekly) return { date: dateStr, slots: [] };

    // 2. Blocks for this day
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const blocks = await this.prisma.client.availabilityBlock.findMany({
      where: { barberId, startAt: { lte: dayEnd }, endAt: { gte: dayStart } },
    });

    // 3. App bookings
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        barberId,
        scheduledAt: { gte: dayStart, lte: dayEnd },
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
      include: {
        client: { select: { name: true } },
        service: { select: { name: true, durationMin: true } },
      },
    });

    // 4. Manual bookings
    const manuals = await this.prisma.client.manualBooking.findMany({
      where: { barberId, date: dayStart },
    });

    // Generate 30-min slots from weekly template
    const slots: { time: string; status: string; ref?: string; detail?: string }[] = [];
    const [startH, startM] = weekly.startTime.split(':').map(Number);
    const [endH, endM] = weekly.endTime.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    for (let m = startMin; m < endMin; m += 30) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const time = `${hh}:${mm}`;
      const timeEnd = `${String(Math.floor((m + 30) / 60)).padStart(2, '0')}:${String((m + 30) % 60).padStart(2, '0')}`;

      // Check blocks
      const blocked = blocks.some((b) => {
        const bStart = `${String(b.startAt.getHours()).padStart(2, '0')}:${String(b.startAt.getMinutes()).padStart(2, '0')}`;
        const bEnd = `${String(b.endAt.getHours()).padStart(2, '0')}:${String(b.endAt.getMinutes()).padStart(2, '0')}`;
        return time < bEnd && timeEnd > bStart;
      });
      if (blocked) { slots.push({ time, status: 'BLOCKED' }); continue; }

      // Check app bookings
      const booking = bookings.find((b) => {
        const bTime = `${String(b.scheduledAt.getHours()).padStart(2, '0')}:${String(b.scheduledAt.getMinutes()).padStart(2, '0')}`;
        return bTime === time;
      });
      if (booking) {
        slots.push({ time, status: 'BOOKED', ref: booking.id, detail: `${booking.client.name} - ${booking.service.name}` });
        continue;
      }

      // Check manual bookings
      const manual = manuals.find((mb) => time >= mb.startTime && time < mb.endTime);
      if (manual) {
        slots.push({ time, status: 'MANUAL', ref: manual.id, detail: manual.clientName ?? 'Cita manual' });
        continue;
      }

      slots.push({ time, status: 'AVAILABLE' });
    }

    return { date: dateStr, dayOfWeek, slots };
  }

  async getWeekAgenda(barberId: string, startDateStr: string) {
    const startDate = new Date(startDateStr);
    const days: { date: string; totalSlots: number; bookedSlots: number; availableSlots: number }[] = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const agenda = await this.getDayAgenda(barberId, dateStr);
      const total = agenda.slots.length;
      const booked = agenda.slots.filter((s) => s.status !== 'AVAILABLE').length;
      days.push({ date: dateStr, totalSlots: total, bookedSlots: booked, availableSlots: total - booked });
    }

    return days;
  }
}
