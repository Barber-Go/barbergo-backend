import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BookingStatus, Role } from '../generated/prisma/client';

interface BoletaResponse {
  folio: string;
  pdf_url: string;
  xml_url?: string;
}

@Injectable()
export class SiiService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly emisorRut: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('SII_API_BASE_URL');
    this.token = this.config.get<string>('SII_API_TOKEN');
    this.emisorRut = this.config.get<string>('SII_EMISOR_RUT');
  }

  async emitirBoleta(amount: number): Promise<BoletaResponse> {
    const fecha = new Date().toISOString().slice(0, 10);

    const body = {
      emisor: this.emisorRut,
      receptor: {
        rut: '66666666-6',
        razon_social: 'Consumidor Final',
        email: '',
      },
      fecha,
      monto: amount,
    };

    const url = `${this.baseUrl}/sii/bhe/emitidas/emitir`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadRequestException(
        `Error al emitir boleta: ${response.status} — ${errorBody}`,
      );
    }

    const data = await response.json();

    return {
      folio: String(data.folio ?? data.numero ?? data.id ?? ''),
      pdf_url: data.pdf_url ?? data.pdf ?? data.url ?? '',
      xml_url: data.xml_url ?? data.xml ?? undefined,
    };
  }

  async emitirBoletaParaBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: { select: { name: true } },
        barber: { select: { userId: true } },
        service: { select: { name: true } },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.barber.userId !== userId)
      throw new BadRequestException('This booking does not belong to you');
    if (booking.status !== BookingStatus.COMPLETED)
      throw new BadRequestException('Booking must be COMPLETED to emit boleta');
    if (booking.boletaFolio)
      throw new ConflictException('Boleta already emitted for this booking');

    const amount = Number(booking.totalAmount);
    const result = await this.emitirBoleta(amount);

    await this.prisma.client.booking.update({
      where: { id: bookingId },
      data: {
        boletaFolio: result.folio,
        boletaPdfUrl: result.pdf_url,
      },
    });

    return {
      folio: result.folio,
      pdfUrl: result.pdf_url,
    };
  }

  async getBoletaByBooking(bookingId: string) {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        boletaFolio: true,
        boletaPdfUrl: true,
        totalAmount: true,
        status: true,
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    return {
      bookingId: booking.id,
      status: booking.status,
      boletaFolio: booking.boletaFolio,
      boletaPdfUrl: booking.boletaPdfUrl,
      emitted: !!booking.boletaFolio,
      amount: Number(booking.totalAmount),
    };
  }
}
