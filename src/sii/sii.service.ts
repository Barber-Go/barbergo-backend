import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../shared/crypto.utils';
import { BookingStatus, Role } from '../generated/prisma/client';

interface BoletaResponse {
  folio: string;
  pdfUrl: string;
  fechaEmision: string;
  codigo: string;
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
    this.baseUrl = this.config.get<string>('SII_API_BASE_URL') ?? 'https://app.apigateway.cl/api/v2';
    this.token = this.config.get<string>('SII_API_TOKEN') ?? '';
    this.emisorRut = this.config.get<string>('SII_EMISOR_RUT') ?? '';
  }

  async emitirBoleta(
    amount: number,
    barberRut: string,
    barberClave: string,
  ): Promise<BoletaResponse> {
    const fecha = new Date().toISOString().slice(0, 10);
    const rutLimpio = barberRut.replace(/\./g, '');

    const body = {
      auth: {
        pass: {
          rut: rutLimpio,
          clave: barberClave,
        },
      },
      boleta: {
        Encabezado: {
          IdDoc: {
            FchEmis: fecha,
            TipoRetencion: 1,
          },
          Emisor: {
            RUTEmisor: rutLimpio,
          },
          Receptor: {
            RUTRecep: '66666666-6',
            RznSocRecep: 'Consumidor Final',
            DirRecep: 'Santiago',
            CmnaRecep: 'Santiago',
          },
        },
        Detalle: [
          {
            NmbItem: 'Servicios de barbería',
            MontoItem: amount,
          },
        ],
      },
    };

    const url = `${this.baseUrl}/sii/bhe/emitidas/emitir`;

    const safeLog = { ...body, auth: { pass: { rut: body.auth.pass.rut, clave: '***' } } };
    console.log('[SII] POST', url);
    console.log('[SII] Body:', JSON.stringify(safeLog));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    const responseBody = await response.text();
    console.log('[SII] Status:', response.status);
    console.log('[SII] Response:', responseBody);

    if (!response.ok) {
      throw new BadRequestException(
        `Error al emitir boleta: ${response.status} — ${responseBody}`,
      );
    }

    const data = JSON.parse(responseBody);

    const folio = String(
      data?.data?.Encabezado?.IdDoc?.Folio ?? data?.folio ?? '',
    );
    const pdfUrl = data?.pdf ?? data?.pdf_url ?? '';
    const fechaEmision =
      data?.data?.Encabezado?.IdDoc?.FchEmis ?? fecha;
    const codigo =
      data?.data?.Encabezado?.IdDoc?.CodigoBarras ?? '';

    return { folio, pdfUrl, fechaEmision, codigo };
  }

  async emitirBoletaParaBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: { select: { name: true } },
        barber: { select: { userId: true, rutTributario: true, claveTributaria: true } },
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

    // Use barber's own RUT if configured, otherwise fall back to company RUT
    if (!booking.barber.rutTributario || !booking.barber.claveTributaria) {
      throw new BadRequestException(
        'Configura tus credenciales SII primero en Gestión → Credenciales SII',
      );
    }

    const barberRut = booking.barber.rutTributario;
    const barberClave = decrypt(booking.barber.claveTributaria);

    const amount = Number(booking.totalAmount);
    const result = await this.emitirBoleta(amount, barberRut, barberClave);

    await this.prisma.client.booking.update({
      where: { id: bookingId },
      data: {
        boletaFolio: result.folio,
        boletaPdfUrl: result.codigo, // CodigoBarras for PDF download
        boletaEstado: 'EMITIDA',
        boletaEmitidaAt: new Date(),
      },
    });

    return {
      folio: result.folio,
      pdfUrl: result.codigo,
      fecha: result.fechaEmision,
      monto: amount,
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

  // ── Mis Boletas ────────────────────────────────────────────────────────────

  private readonly RATE = 0.1525;

  async listarBoletas(userId: string, mes: number, anio: number) {
    const profile = await this.prisma.client.barberProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Barber profile not found');

    const start = new Date(anio, mes - 1, 1);
    const end = new Date(anio, mes, 1);

    const bookings = await this.prisma.client.booking.findMany({
      where: {
        barberId: profile.id,
        boletaFolio: { not: null },
        boletaEmitidaAt: { gte: start, lt: end },
      },
      orderBy: { boletaEmitidaAt: 'desc' },
      select: {
        id: true,
        boletaFolio: true,
        boletaPdfUrl: true,
        boletaEstado: true,
        boletaEmitidaAt: true,
        boletaAnuladaAt: true,
        boletaAnulMotivo: true,
        totalAmount: true,
      },
    });

    const boletas = bookings.map((b) => {
      const monto = Number(b.totalAmount);
      const retencion = Math.round(monto * this.RATE);
      return {
        id: b.id,
        folio: b.boletaFolio,
        fecha: b.boletaEmitidaAt?.toISOString() ?? null,
        monto,
        retencion,
        liquido: monto - retencion,
        estado: b.boletaEstado ?? 'EMITIDA',
        pdfUrl: b.boletaPdfUrl,
        anuladaAt: b.boletaAnuladaAt?.toISOString() ?? null,
        anulMotivo: b.boletaAnulMotivo,
        bookingId: b.id,
      };
    });

    const activas = boletas.filter((b) => b.estado === 'EMITIDA');
    return {
      mes,
      anio,
      boletas,
      totalBruto: activas.reduce((s, b) => s + b.monto, 0),
      totalLiquido: activas.reduce((s, b) => s + b.liquido, 0),
      count: boletas.length,
    };
  }

  async getBoletaPdf(userId: string, bookingId: string): Promise<{ buffer: Buffer; folio: string }> {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      include: {
        barber: {
          select: { userId: true, rutTributario: true, claveTributaria: true },
        },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.barber.userId !== userId)
      throw new BadRequestException('This booking does not belong to you');
    if (!booking.boletaPdfUrl)
      throw new NotFoundException('No PDF available for this boleta');
    if (!booking.barber.rutTributario || !booking.barber.claveTributaria)
      throw new BadRequestException('Credenciales SII no configuradas');

    const codigo = booking.boletaPdfUrl;
    const rutLimpio = booking.barber.rutTributario.replace(/\./g, '');
    const url = `${this.baseUrl}/sii/bhe/emitidas/pdf/${codigo}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${this.token}`,
      },
      body: JSON.stringify({
        auth: {
          pass: {
            rut: rutLimpio,
            clave: decrypt(booking.barber.claveTributaria),
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadRequestException(
        `Error al obtener PDF: ${response.status} — ${errorBody}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      folio: booking.boletaFolio ?? '',
    };
  }

  async anularBoleta(
    userId: string,
    bookingId: string,
    body: { folio: string; causa?: number },
  ) {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      include: {
        barber: {
          select: { userId: true, rutTributario: true, claveTributaria: true },
        },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.barber.userId !== userId)
      throw new BadRequestException('This booking does not belong to you');
    if (!booking.boletaFolio)
      throw new BadRequestException('This booking has no boleta');
    if (booking.boletaEstado === 'ANULADA')
      throw new ConflictException('Boleta already voided');
    if (String(booking.boletaFolio) !== String(body.folio))
      throw new BadRequestException('El folio no coincide');
    if (!booking.barber.rutTributario || !booking.barber.claveTributaria)
      throw new BadRequestException('Credenciales SII no configuradas');

    const causa = body.causa ?? 3; // 1=sin pago, 2=sin prestación, 3=error digitación
    const emisor = booking.barber.rutTributario;
    const url = `${this.baseUrl}/sii/bhe/emitidas/anular/${emisor}/${body.folio}?causa=${causa}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${this.token}`,
      },
      body: JSON.stringify({
        auth: {
          pass: {
            rut: emisor,
            clave: decrypt(booking.barber.claveTributaria),
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadRequestException(
        `Error al anular boleta: ${response.status} — ${errorBody}`,
      );
    }

    await this.prisma.client.booking.update({
      where: { id: bookingId },
      data: {
        boletaEstado: 'ANULADA',
        boletaAnuladaAt: new Date(),
        boletaAnulMotivo: `causa_${causa}`,
      },
    });

    return { success: true, folio: booking.boletaFolio, estado: 'ANULADA' };
  }
}
