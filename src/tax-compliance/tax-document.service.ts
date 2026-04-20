import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaxDocStatus, TaxDocumentType, BookingStatus } from '../generated/prisma/enums';

const SII_REAL_ENABLED = process.env['FEATURE_FLAG_SII_REAL'] === 'true';

interface CreateDocumentDto {
  documentType: 'BOLETA' | 'FACTURA';
  amount: number;
  period: string;
  barbershopId?: string;
  receptorRut?: string;
  receptorName?: string;
  receptorAddress?: string;
}

@Injectable()
export class TaxDocumentService {
  constructor(private readonly prisma: PrismaService) {}

  async createDocument(userId: string, dto: CreateDocumentDto) {
    if (dto.amount <= 0) throw new BadRequestException('Monto debe ser mayor a 0');

    // Get emitter info from TaxProfile
    const shop = await this.prisma.client.barbershopProfile.findFirst({
      where: { userId, deletedAt: null },
    });
    const taxProfile = shop
      ? await this.prisma.client.taxProfile.findUnique({ where: { barbershopId: shop.id } })
      : null;

    const emitterRut = taxProfile?.rut ?? '00.000.000-0';
    const emitterName = taxProfile?.razonSocial ?? 'BarberGo SpA';

    const taxAmount = dto.documentType === 'FACTURA' ? Math.round(dto.amount * 0.19) : 0;
    const totalAmount = dto.amount + taxAmount;

    if (SII_REAL_ENABLED) {
      // Future: call apigateway.cl
      throw new BadRequestException('Emision real SII no disponible aun');
    }

    // Simulated emission
    const folio = Math.floor(1000 + Math.random() * 9000);

    const doc = await this.prisma.client.taxDocument.create({
      data: {
        userId,
        barbershopId: dto.barbershopId ?? null,
        documentType: dto.documentType === 'FACTURA' ? TaxDocumentType.FACTURA : TaxDocumentType.BOLETA,
        amount: dto.amount,
        taxAmount,
        totalAmount,
        period: dto.period,
        folio,
        status: TaxDocStatus.SIMULATED,
        emitterRut,
        emitterName,
        receptorRut: dto.receptorRut ?? null,
        receptorName: dto.receptorName ?? null,
        receptorAddress: dto.receptorAddress ?? null,
      },
    });

    return {
      data: {
        id: doc.id,
        folio: doc.folio,
        documentType: doc.documentType,
        amount: doc.amount,
        taxAmount: doc.taxAmount,
        totalAmount: doc.totalAmount,
        status: doc.status,
        issuedAt: doc.issuedAt.toISOString(),
        emitterRut: doc.emitterRut,
        emitterName: doc.emitterName,
      },
      message: SII_REAL_ENABLED ? 'Documento emitido' : 'Documento simulado',
      statusCode: 201,
    };
  }

  async getDocuments(userId: string, period?: string, barbershopId?: string) {
    const where: Record<string, unknown> = { userId, deletedAt: null };
    if (period) where.period = period;
    if (barbershopId) where.barbershopId = barbershopId;

    const docs = await this.prisma.client.taxDocument.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: 50,
    });

    return {
      data: docs.map((d) => ({
        id: d.id,
        folio: d.folio,
        documentType: d.documentType,
        amount: d.amount,
        taxAmount: d.taxAmount,
        totalAmount: d.totalAmount,
        period: d.period,
        status: d.status,
        issuedAt: d.issuedAt.toISOString(),
        emitterName: d.emitterName,
        receptorName: d.receptorName,
      })),
      message: 'OK',
      statusCode: 200,
    };
  }

  async cancelDocument(userId: string, docId: string, reason?: string) {
    const doc = await this.prisma.client.taxDocument.findFirst({
      where: { id: docId, userId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    if (doc.status === TaxDocStatus.CANCELLED) throw new BadRequestException('Documento ya anulado');
    if (doc.status === TaxDocStatus.EMITTED && SII_REAL_ENABLED) {
      throw new BadRequestException('No se puede anular un documento ya emitido en SII');
    }

    await this.prisma.client.taxDocument.update({
      where: { id: docId },
      data: { status: TaxDocStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: reason ?? 'Anulado por el usuario' },
    });

    return { message: 'Documento anulado', statusCode: 200 };
  }

  async getSummary(userId: string, period?: string, barbershopId?: string) {
    const now = new Date();
    const targetPeriod = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const where: Record<string, unknown> = { userId, period: targetPeriod, deletedAt: null, status: { not: TaxDocStatus.CANCELLED } };
    if (barbershopId) where.barbershopId = barbershopId;

    const docs = await this.prisma.client.taxDocument.findMany({ where });

    let boletaCount = 0, boletaTotal = 0, facturaCount = 0, facturaTotal = 0;
    for (const d of docs) {
      if (d.documentType === TaxDocumentType.BOLETA) { boletaCount++; boletaTotal += d.totalAmount; }
      else { facturaCount++; facturaTotal += d.totalAmount; }
    }
    const totalInvoiced = boletaTotal + facturaTotal;

    // Real income from bookings
    const shops = await this.prisma.client.barbershopProfile.findMany({
      where: { userId, deletedAt: null, ...(barbershopId ? { id: barbershopId } : {}) },
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    const [year, month] = targetPeriod.split('-').map(Number);
    const rangeFrom = new Date(Date.UTC(year, month - 1, 1));
    const rangeTo = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const bookingsAgg = await this.prisma.client.booking.aggregate({
      where: {
        barbershopId: { in: shopIds },
        status: BookingStatus.COMPLETED,
        scheduledAt: { gte: rangeFrom, lte: rangeTo },
        deletedAt: null,
      },
      _sum: { grossAmount: true },
    });
    const realIncome = Math.round(Number(bookingsAgg._sum.grossAmount ?? 0));
    const gap = realIncome - totalInvoiced;
    const gapPercent = realIncome > 0 ? Math.round((gap / realIncome) * 1000) / 10 : 0;

    return {
      data: {
        period: targetPeriod,
        totalInvoiced,
        documentsCount: docs.length,
        realIncome,
        gap,
        gapPercent,
        byType: {
          BOLETA: { count: boletaCount, total: boletaTotal },
          FACTURA: { count: facturaCount, total: facturaTotal },
        },
      },
      message: 'OK',
      statusCode: 200,
    };
  }
}
