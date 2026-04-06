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
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { BookingStatus, LedgerEntryType, NotificationType, Role } from '../generated/prisma/enums';

// Status transitions allowed per role
const CLIENT_ALLOWED_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.PENDING]: [BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.CANCELLED],
};

const BARBER_ALLOWED_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
};

// Shared include for consistent response shape
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
  ) {}

  // ── CLIENT: create booking ─────────────────────────────────────────────────

  async create(clientId: string, dto: CreateBookingDto) {
    // Validate barber + service belong together and are active
    const service = await this.prisma.client.serviceItem.findFirst({
      where: {
        id: dto.serviceId,
        barberId: dto.barberId,
        isActive: true,
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found for this barber');
    }

    const barber = await this.prisma.client.barberProfile.findUnique({
      where: { id: dto.barberId, isActive: true },
      select: { id: true, isActive: true, userId: true, employmentType: true, commissionRate: true },
    });

    if (!barber) {
      throw new NotFoundException('Barber not found');
    }

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    // Check for scheduling conflicts (same barber, overlapping slot)
    const conflict = await this.prisma.client.booking.findFirst({
      where: {
        barberId: dto.barberId,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        scheduledAt: {
          gte: new Date(scheduledAt.getTime() - service.durationMin * 60 * 1000),
          lt: new Date(scheduledAt.getTime() + service.durationMin * 60 * 1000),
        },
      },
    });

    if (conflict) {
      throw new BadRequestException('This time slot is already taken');
    }

    const calc = this.commissions.calculate({
      grossAmount: Number(service.price),
      employmentType: barber.employmentType,
      paymentMethod: dto.paymentMethod,
      service: { id: service.id, name: service.name, price: Number(service.price), durationMin: service.durationMin },
    });

    const booking = await this.prisma.client.booking.create({
      data: {
        clientId,
        barberId: dto.barberId,
        serviceId: dto.serviceId,
        scheduledAt,
        paymentMethod: dto.paymentMethod,
        // V1
        totalAmount: calc.totalAmount,
        platformFee: calc.platformFee,
        barberNet: calc.barberNet,
        // V2
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

    // Notify the barber
    const barberUserId = await this.getBarberUserId(dto.barberId);
    const dateStr = scheduledAt.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    this.notifications
      .create(
        barberUserId,
        NotificationType.BOOKING_CREATED,
        'Nueva reserva',
        `Tienes una nueva reserva para ${service.name} el ${dateStr}`,
      )
      .catch(() => {}); // fire-and-forget

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
    const barber = await this.prisma.client.barberProfile.findUnique({
      where: { userId },
    });
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

    const isOwner =
      booking.clientId === requesterId ||
      barberUserId === requesterId ||
      requesterRole === Role.ADMIN;

    if (!isOwner) throw new ForbiddenException();

    return this.formatBooking(booking);
  }

  // ── UPDATE status ──────────────────────────────────────────────────────────

  async updateStatus(
    id: string,
    dto: UpdateBookingStatusDto,
    requesterId: string,
    requesterRole: Role,
  ) {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    const barberUserId = await this.getBarberUserId(booking.barberId);

    // Determine what transitions this requester can make
    let allowed: BookingStatus[] | undefined;

    if (requesterRole === Role.CLIENT && booking.clientId === requesterId) {
      allowed = CLIENT_ALLOWED_TRANSITIONS[booking.status];
    } else if (requesterRole === Role.BARBER && barberUserId === requesterId) {
      allowed = BARBER_ALLOWED_TRANSITIONS[booking.status];
    } else if (requesterRole === Role.ADMIN) {
      allowed = Object.values(BookingStatus);
    }

    if (!allowed) throw new ForbiddenException();

    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${booking.status} to ${dto.status}`,
      );
    }

    const updated = await this.prisma.client.booking.update({
      where: { id },
      data: { status: dto.status },
      include: BOOKING_INCLUDE,
    });

    // When COMPLETED, create Earning record
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

      // Create ledger entry for automatic accounting
      await this.prisma.client.dailyLedgerEntry.create({
        data: {
          barberId: booking.barberId,
          date: new Date(),
          type: LedgerEntryType.INCOME,
          label: `Servicio: ${updated.service.name}`,
          amount: Number(booking.totalAmount),
        },
      });
    }

    // Send notification to client based on new status
    const serviceName = updated.service.name;
    const barberName = updated.barber.user.name;

    if (dto.status === BookingStatus.CONFIRMED) {
      this.notifications
        .create(booking.clientId, NotificationType.BOOKING_CONFIRMED, 'Reserva confirmada', `Tu reserva de ${serviceName} fue confirmada`)
        .catch(() => {});
      // Auto-create chat thread
      const barberUserId = await this.getBarberUserId(booking.barberId);
      this.chat
        .createThreadForBooking(booking.id, booking.clientId, barberUserId, serviceName)
        .catch(() => {});
    } else if (dto.status === BookingStatus.CANCELLED) {
      this.notifications
        .create(booking.clientId, NotificationType.BOOKING_CANCELLED, 'Reserva cancelada', `Tu reserva de ${serviceName} fue cancelada`)
        .catch(() => {});
      this.chat.sendSystemMessage(booking.id, 'Reserva cancelada').catch(() => {});
    } else if (dto.status === BookingStatus.COMPLETED) {
      this.notifications
        .create(booking.clientId, NotificationType.BOOKING_COMPLETED, '¿Cómo fue tu experiencia?', `Califica tu cita de ${serviceName} con ${barberName}`)
        .catch(() => {});
      this.chat.sendSystemMessage(booking.id, 'Reserva completada').catch(() => {});
    }

    return this.formatBooking(updated);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getBarberUserId(barberId: string): Promise<string> {
    const barber = await this.prisma.client.barberProfile.findUnique({
      where: { id: barberId },
      select: { userId: true },
    });
    return barber?.userId ?? '';
  }

  private formatBooking(booking: any) {
    return {
      id: booking.id,
      status: booking.status,
      scheduledAt: booking.scheduledAt.toISOString(),
      paymentMethod: booking.paymentMethod,
      totalAmount: Number(booking.totalAmount),
      platformFee: Number(booking.platformFee),
      barberNet: Number(booking.barberNet),
      createdAt: booking.createdAt.toISOString(),
      service: {
        id: booking.service.id,
        name: booking.service.name,
        price: Number(booking.service.price),
        durationMin: booking.service.durationMin,
      },
      barber: {
        id: booking.barber.id,
        name: booking.barber.user.name,
        avatarUrl: booking.barber.user.avatarUrl,
      },
      client: {
        id: booking.client.id,
        name: booking.client.name,
        avatarUrl: booking.client.avatarUrl,
      },
      hasReview: booking.review != null,
    };
  }
}
