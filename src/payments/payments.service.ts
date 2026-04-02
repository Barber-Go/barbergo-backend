import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebpayPlus, Options, Environment } from 'transbank-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { BookingStatus, PaymentStatus } from '../generated/prisma/client';

@Injectable()
export class PaymentsService {
  private readonly tx: InstanceType<typeof WebpayPlus.Transaction>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const commerceCode = this.config.get<string>('TRANSBANK_COMMERCE_CODE');
    const apiKey = this.config.get<string>('TRANSBANK_API_KEY');
    const env = this.config.get<string>('TRANSBANK_ENV');

    const environment =
      env === 'production' ? Environment.Production : Environment.Integration;

    this.tx = new WebpayPlus.Transaction(
      new Options(commerceCode, apiKey, environment),
    );
  }

  async createTransaction(
    userId: string,
    bookingId: string,
    amount: number,
    returnUrl: string,
  ) {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.clientId !== userId)
      throw new BadRequestException('Booking does not belong to this user');
    if (booking.status === BookingStatus.CANCELLED)
      throw new BadRequestException('Booking is cancelled');

    const existingPayment = await this.prisma.client.payment.findUnique({
      where: { bookingId },
    });
    if (existingPayment?.status === PaymentStatus.COMPLETED) {
      throw new ConflictException('Booking already paid');
    }

    const buyOrder = `BO-${bookingId.slice(-8)}-${Date.now()}`;
    const sessionId = `S-${userId.slice(-8)}`;

    const response = await this.tx.create(
      buyOrder,
      sessionId,
      amount,
      returnUrl,
    );

    // Upsert payment record as PENDING
    await this.prisma.client.payment.upsert({
      where: { bookingId },
      create: {
        bookingId,
        method: 'IN_APP',
        amount,
        status: PaymentStatus.PENDING,
        transactionRef: response.token,
      },
      update: {
        amount,
        status: PaymentStatus.PENDING,
        transactionRef: response.token,
      },
    });

    return { token: response.token, url: response.url };
  }

  async confirmTransaction(tokenWs: string) {
    const response = await this.tx.commit(tokenWs);

    const payment = await this.prisma.client.payment.findFirst({
      where: { transactionRef: tokenWs },
    });

    if (!payment) throw new NotFoundException('Payment record not found');

    const approved = response.response_code === 0;

    if (approved) {
      await this.prisma.client.$transaction([
        this.prisma.client.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.COMPLETED,
            transactionRef: `${tokenWs}|auth:${response.authorization_code}`,
          },
        }),
        this.prisma.client.booking.update({
          where: { id: payment.bookingId },
          data: { status: BookingStatus.CONFIRMED },
        }),
      ]);
    } else {
      await this.prisma.client.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
    }

    return {
      status: approved ? 'APPROVED' : 'REJECTED',
      amount: response.amount,
      authorizationCode: response.authorization_code ?? null,
      bookingId: payment.bookingId,
      responseCode: response.response_code,
    };
  }

  async getPaymentByBooking(bookingId: string) {
    const payment = await this.prisma.client.payment.findUnique({
      where: { bookingId },
    });

    if (!payment) throw new NotFoundException('No payment found for this booking');

    return {
      id: payment.id,
      bookingId: payment.bookingId,
      method: payment.method,
      amount: Number(payment.amount),
      status: payment.status,
      createdAt: payment.createdAt,
    };
  }
}
