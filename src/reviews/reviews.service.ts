import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { BookingStatus } from '../generated/prisma/enums';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, dto: CreateReviewDto) {
    // 1. Booking must exist
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: dto.bookingId },
      include: { review: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    // 2. Only the client who made the booking can review
    if (booking.clientId !== clientId) throw new ForbiddenException();

    // 3. Booking must be completed
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('Only completed bookings can be reviewed');
    }

    // 4. No duplicate reviews
    if (booking.review) {
      throw new ConflictException('This booking has already been reviewed');
    }

    // 5. Create the review
    const review = await this.prisma.client.review.create({
      data: {
        bookingId: dto.bookingId,
        clientId,
        barberId: booking.barberId,
        rating: dto.rating,
        comment: dto.comment ?? null,
      },
      include: {
        client: { select: { name: true, avatarUrl: true } },
      },
    });

    // 6. Recalculate barber's average rating
    const aggregate = await this.prisma.client.review.aggregate({
      where: { barberId: booking.barberId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.client.barber.update({
      where: { id: booking.barberId },
      data: {
        rating: Number((aggregate._avg.rating ?? 0).toFixed(2)),
        totalReviews: aggregate._count.rating,
      },
    });

    return {
      id: review.id,
      bookingId: review.bookingId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt.toISOString(),
      clientName: review.client.name,
      clientAvatarUrl: review.client.avatarUrl,
    };
  }
}
