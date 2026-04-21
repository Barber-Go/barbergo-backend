import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CommissionsService } from '../commissions/commissions.service';
import { ChatService } from '../chat/chat.service';
import { PointsService } from '../points/points.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { BookingStatus, LedgerEntryType, NotificationType, PaymentMethod, Role } from '../generated/prisma/enums';

// Status transitions — PENDING eliminated, instant booking
const CLIENT_ALLOWED_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.CONFIRMED]: [BookingStatus.CANCELLED],
};

const BARBER_ALLOWED_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.NO_SHOW],
};

const BOOKING_INCLUDE = {
  service: { select: { id: true, name: true, price: true, durationMin: true } },
  barber: {
    select: {
      id: true,
      user: { select: { name: true, avatarUrl: true } },
    },
  },
  client: { select: { id: true, name: true, avatarUrl: true } },
  review: { select: { id: true } },
} as const;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly commissions: CommissionsService,
    private readonly chat: ChatService,
    private readonly points: PointsService,
  ) {}

  // ── CLIENT: instant booking ───────────────────────────────────────────────

  async create(clientId: string, dto: CreateBookingDto) {
    const service = await this.prisma.client.serviceItem.findFirst({
      where: { id: dto.serviceId, barberId: dto.barberId, isActive: true },
    });
    if (!service) throw new NotFoundException('Servicio no encontrado');

    const barber = await this.prisma.client.barberProfile.findUnique({
      where: { id: dto.barberId, isActive: true },
      select: { id: true, userId: true, employmentType: true, commissionRate: true },
    });
    if (!barber) throw new NotFoundException('Barbero no encontrado');

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) {
      throw new BadRequestException('La fecha debe ser en el futuro');
    }

    const endTime = new Date(scheduledAt.getTime() + service.durationMin * 60000);

    // Atomic validation + creation in a transaction
    const booking = await this.prisma.client.$transaction(async (tx) => {
      // Check weekly availability
      const dayOfWeek = scheduledAt.getDay();
      const availability = await tx.weeklyAvailability.findFirst({
        where: { barberId: dto.barberId, dayOfWeek, isActive: true },
      });
      if (!availability) {
        throw new BadRequestException('El barbero no trabaja ese día');
      }

      const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
      const slotStart = scheduledAt.getHours() * 60 + scheduledAt.getMinutes();
      const slotEnd = endTime.getHours() * 60 + endTime.getMinutes();
      const availStart = toMinutes(availability.startTime);
      const availEnd = toMinutes(availability.endTime);

      if (slotStart < availStart || slotEnd > availEnd) {
        const pad = (n: number) => String(n).padStart(2, '0');
        throw new BadRequestException(
          `El barbero trabaja entre ${pad(Math.floor(availStart / 60))}:${pad(availStart % 60)} y ${pad(Math.floor(availEnd / 60))}:${pad(availEnd % 60)}`,
        );
      }

      // Check for overlapping CONFIRMED bookings
      const conflicts = await tx.booking.findMany({
        where: {
          barberId: dto.barberId,
          status: BookingStatus.CONFIRMED,
          deletedAt: null,
          scheduledAt: {
            lt: endTime,
          },
        },
        include: { service: { select: { durationMin: true } } },
      });

      for (const c of conflicts) {
        const cEnd = new Date(c.scheduledAt.getTime() + (c.service?.durationMin ?? 30) * 60000);
        if (cEnd > scheduledAt) {
          throw new BadRequestException('Ese horario ya está reservado');
        }
      }

      // Calculate financial snapshot
      const calc = this.commissions.calculate({
        grossAmount: Number(service.price),
        employmentType: barber.employmentType,
        paymentMethod: dto.paymentMethod,
        service: { id: service.id, name: service.name, price: Number(service.price), durationMin: service.durationMin },
      });

      // Create booking as CONFIRMED instantly
      return tx.booking.create({
        data: {
          clientId,
          barberId: dto.barberId,
          serviceId: dto.serviceId,
          scheduledAt,
          status: BookingStatus.CONFIRMED,
          paymentMethod: dto.paymentMethod,
          totalAmount: calc.totalAmount,
          platformFee: calc.platformFee,
          barberNet: calc.barberNet,
          grossAmount: calc.grossAmount,
          platformFeePercent: calc.platformFeePercent,
          distributableAmount: calc.distributableAmount,
          barberAmount: calc.barberAmount,
          shopAmount: calc.shopAmount,
          netPayoutToBarber: calc.netPayoutToBarber,
          serviceSnapshot: calc.serviceSnapshot,
        },
        include: BOOKING_INCLUDE,
      });
    });

    // Post-creation side effects (fire-and-forget)
    const barberUserId = barber.userId;
    const dateStr = scheduledAt.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });

    this.notifications
      .create(barberUserId, NotificationType.BOOKING_CONFIRMED, 'Nueva reserva confirmada', `Tienes una reserva de ${service.name} el ${dateStr}`)
      .catch(() => {});

    this.chat
      .createThreadForBooking(booking.id, clientId, barberUserId, service.name)
      .catch(() => {});

    return this.formatBooking(booking);
  }

  // ── CLIENT: list own bookings ──────────────────────────────────────────────

  async findForClient(clientId: string) {
    const bookings = await this.prisma.client.booking.findMany({
      where: { clientId },
      orderBy: { scheduledAt: 'desc' },
      include: BOOKING_INCLUDE,
    });
    return bookings.map((b) => this.formatBooking(b));
  }

  // ── BARBER: list own bookings ──────────────────────────────────────────────

  async findForBarber(userId: string) {
    const barber = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!barber) throw new NotFoundException('Barber profile not found');

    const bookings = await this.prisma.client.booking.findMany({
      where: { barberId: barber.id },
      orderBy: { scheduledAt: 'desc' },
      include: BOOKING_INCLUDE,
    });
    return bookings.map((b) => this.formatBooking(b));
  }

  // ── GET single booking ─────────────────────────────────────────────────────

  async findOne(id: string, requesterId: string, requesterRole: Role) {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id },
      include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const barberUserId = await this.getBarberUserId(booking.barberId);
    const isOwner = booking.clientId === requesterId || barberUserId === requesterId || requesterRole === Role.ADMIN;
    if (!isOwner) throw new ForbiddenException();

    return this.formatBooking(booking);
  }

  // ── UPDATE status ──────────────────────────────────────────────────────────

  async updateStatus(id: string, dto: UpdateBookingStatusDto, requesterId: string, requesterRole: Role) {
    if (dto.status === BookingStatus.PENDING) {
      throw new BadRequestException('El estado PENDING ya no existe. Las reservas se confirman al instante.');
    }

    const booking = await this.prisma.client.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');

    const barberUserId = await this.getBarberUserId(booking.barberId);

    let allowed: BookingStatus[] | undefined;
    if (booking.clientId === requesterId) {
      allowed = CLIENT_ALLOWED_TRANSITIONS[booking.status];
    } else if (barberUserId === requesterId) {
      allowed = BARBER_ALLOWED_TRANSITIONS[booking.status];
    } else if (requesterRole === Role.ADMIN) {
      allowed = [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.NO_SHOW];
    }

    if (!allowed) throw new ForbiddenException();
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(`No se puede cambiar de ${booking.status} a ${dto.status}`);
    }

    const updated = await this.prisma.client.booking.update({
      where: { id },
      data: { status: dto.status },
      include: BOOKING_INCLUDE,
    });

    // Side effects on COMPLETED
    if (dto.status === BookingStatus.COMPLETED) {
      await this.prisma.client.earning.upsert({
        where: { bookingId: id },
        create: {
          barberId: booking.barberId,
          bookingId: id,
          date: new Date(),
          grossAmount: booking.totalAmount,
          platformFee: booking.platformFee,
          netAmount: booking.barberNet,
          paymentMethod: booking.paymentMethod,
        },
        update: {},
      });

      await this.prisma.client.dailyLedgerEntry.create({
        data: {
          barberId: booking.barberId,
          date: new Date(),
          type: LedgerEntryType.INCOME,
          label: `Servicio: ${updated.service.name}`,
          amount: Number(booking.totalAmount),
        },
      });

      if (booking.paymentMethod === PaymentMethod.IN_APP) {
        this.points.accruePoints(booking.clientId, Number(booking.totalAmount)).catch(() => {});
      }
    }

    // Notifications
    const serviceName = updated.service.name;
    const barberName = updated.barber.user.name;

    if (dto.status === BookingStatus.CANCELLED) {
      this.notifications.create(booking.clientId, NotificationType.BOOKING_CANCELLED, 'Reserva cancelada', `Tu reserva de ${serviceName} fue cancelada`).catch(() => {});
      this.chat.sendSystemMessage(booking.id, 'Reserva cancelada').catch(() => {});
    } else if (dto.status === BookingStatus.COMPLETED) {
      this.notifications.create(booking.clientId, NotificationType.BOOKING_COMPLETED, `¿Cómo estuvo tu corte con ${barberName}?`, 'Califica y deja propina').catch(() => {});
      this.chat.sendSystemMessage(booking.id, 'Reserva completada').catch(() => {});
    }

    return this.formatBooking(updated);
  }

  // ── Rating reminder ──────────────────────────────────────────────────────

  async getPendingRating(clientId: string) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const booking = await this.prisma.client.booking.findFirst({
      where: {
        clientId,
        status: 'COMPLETED',
        hasTip: false,
        rateReminderStatus: 'PENDING',
        updatedAt: { gte: sevenDaysAgo },
        deletedAt: null,
        OR: [
          { rateReminderLastShownAt: null },
          { rateReminderLastShownAt: { lt: twentyFourHoursAgo } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        barber: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        },
        service: { select: { name: true, durationMin: true } },
      },
    });

    if (!booking) return null;

    // Update lastShownAt
    await this.prisma.client.booking.update({
      where: { id: booking.id },
      data: { rateReminderLastShownAt: new Date() },
    });

    return {
      id: booking.id,
      barberId: booking.barber.id,
      barber: {
        name: booking.barber.user.name,
        avatarUrl: booking.barber.user.avatarUrl,
        rating: booking.barber.rating,
      },
      service: { name: booking.service.name, durationMin: booking.service.durationMin },
      scheduledAt: booking.scheduledAt,
      completedAt: booking.updatedAt,
      grossAmount: Number(booking.grossAmount),
      paymentMethod: booking.paymentMethod,
    };
  }

  async skipRating(bookingId: string, clientId: string) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, clientId, deletedAt: null },
      select: { rateReminderSkipCount: true },
    });
    if (!booking) return;

    const newCount = booking.rateReminderSkipCount + 1;
    await this.prisma.client.booking.update({
      where: { id: bookingId },
      data: {
        rateReminderSkipCount: newCount,
        rateReminderLastShownAt: new Date(),
        rateReminderStatus: newCount >= 3 ? 'SKIPPED_MAX' : 'PENDING',
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getBarberUserId(barberId: string): Promise<string> {
    const barber = await this.prisma.client.barberProfile.findUnique({ where: { id: barberId }, select: { userId: true } });
    return barber?.userId ?? '';
  }

  private formatBooking(booking: Record<string, unknown>) {
    const b = booking as Record<string, unknown> & {
      id: string; status: string; scheduledAt: Date; paymentMethod: string;
      totalAmount: unknown; platformFee: unknown; barberNet: unknown; createdAt: Date;
      service: { id: string; name: string; price: unknown; durationMin: number };
      barber: { id: string; user: { name: string; avatarUrl: string | null } };
      client: { id: string; name: string; avatarUrl: string | null };
      review: { id: string } | null;
    };
    return {
      id: b.id,
      status: b.status,
      scheduledAt: b.scheduledAt.toISOString(),
      paymentMethod: b.paymentMethod,
      totalAmount: Number(b.totalAmount),
      platformFee: Number(b.platformFee),
      barberNet: Number(b.barberNet),
      createdAt: b.createdAt.toISOString(),
      service: { id: b.service.id, name: b.service.name, price: Number(b.service.price), durationMin: b.service.durationMin },
      barber: { id: b.barber.id, name: b.barber.user.name, avatarUrl: b.barber.user.avatarUrl },
      client: { id: b.client.id, name: b.client.name, avatarUrl: b.client.avatarUrl },
      hasReview: b.review != null,
    };
  }
}
