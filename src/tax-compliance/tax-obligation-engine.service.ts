import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ProfileFlags {
  taxProfileId: string;
  vatAffectation: boolean;
  issuesDte: boolean;
  hasEmployees: boolean;
  withholdsHonorarios: boolean;
}

const SII_URLS: Record<string, string> = {
  F29: 'https://www4.sii.cl/f29ui/',
  RCV: 'https://www4.sii.cl/registrocompaborui/',
  F22: 'https://www4.sii.cl/renta/',
  COTIZACIONES: 'https://www.previred.com',
  RETENCIONES_BHE: 'https://www4.sii.cl/f29ui/',
};

@Injectable()
export class TaxObligationEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async generateForYear(profile: ProfileFlags, year: number): Promise<number> {
    let generated = 0;
    const now = new Date();

    // Monthly obligations (Jan-Dec)
    for (let month = 1; month <= 12; month++) {
      const period = `${year}-${String(month).padStart(2, '0')}`;
      const dueMonth = month === 12 ? 1 : month + 1;
      const dueYear = month === 12 ? year + 1 : year;

      if (profile.vatAffectation) {
        const created = await this.upsertObligation({
          taxProfileId: profile.taxProfileId,
          type: 'F29',
          name: `Declaración F29 — ${this.monthName(month)} ${year}`,
          description: 'Declaración mensual de IVA y retenciones',
          dueDate: new Date(dueYear, dueMonth - 1, 12),
          period,
          siiFormUrl: SII_URLS.F29,
          now,
        });
        if (created) generated++;
      }

      if (profile.issuesDte) {
        const created = await this.upsertObligation({
          taxProfileId: profile.taxProfileId,
          type: 'RCV',
          name: `Registro Compra/Venta — ${this.monthName(month)} ${year}`,
          description: 'Registro de compras y ventas con DTE',
          dueDate: new Date(dueYear, dueMonth - 1, 12),
          period,
          siiFormUrl: SII_URLS.RCV,
          now,
        });
        if (created) generated++;
      }

      if (profile.hasEmployees) {
        const created = await this.upsertObligation({
          taxProfileId: profile.taxProfileId,
          type: 'COTIZACIONES',
          name: `Cotizaciones — ${this.monthName(month)} ${year}`,
          description: 'Pago de AFP, salud e invalidez',
          dueDate: new Date(dueYear, dueMonth - 1, 10),
          period,
          siiFormUrl: SII_URLS.COTIZACIONES,
          now,
        });
        if (created) generated++;
      }

      if (profile.withholdsHonorarios) {
        const created = await this.upsertObligation({
          taxProfileId: profile.taxProfileId,
          type: 'RETENCIONES_BHE',
          name: `Retenciones BHE — ${this.monthName(month)} ${year}`,
          description: 'Retención de boletas de honorarios en F29',
          dueDate: new Date(dueYear, dueMonth - 1, 12),
          period,
          siiFormUrl: SII_URLS.RETENCIONES_BHE,
          now,
        });
        if (created) generated++;
      }
    }

    // Annual: F22
    const f22Created = await this.upsertObligation({
      taxProfileId: profile.taxProfileId,
      type: 'F22',
      name: `Declaración de Renta F22 — Año ${year}`,
      description: 'Declaración anual de renta ante el SII',
      dueDate: new Date(year + 1, 3, 30), // April 30 of next year
      period: String(year),
      siiFormUrl: SII_URLS.F22,
      now,
    });
    if (f22Created) generated++;

    return generated;
  }

  private async upsertObligation(params: {
    taxProfileId: string;
    type: string;
    name: string;
    description: string;
    dueDate: Date;
    period: string;
    siiFormUrl: string;
    now: Date;
  }): Promise<boolean> {
    const existing = await this.prisma.client.taxObligation.findUnique({
      where: {
        taxProfileId_type_period: {
          taxProfileId: params.taxProfileId,
          type: params.type,
          period: params.period,
        },
      },
    });

    // Don't touch COMPLETED or SKIPPED
    if (existing && (existing.status === 'COMPLETED' || existing.status === 'SKIPPED')) {
      return false;
    }

    const status = params.dueDate < params.now ? 'OVERDUE' : 'PENDING';

    if (existing) {
      await this.prisma.client.taxObligation.update({
        where: { id: existing.id },
        data: { status, name: params.name, description: params.description, dueDate: params.dueDate, siiFormUrl: params.siiFormUrl },
      });
      return false;
    }

    await this.prisma.client.taxObligation.create({
      data: {
        taxProfileId: params.taxProfileId,
        type: params.type,
        name: params.name,
        description: params.description,
        dueDate: params.dueDate,
        period: params.period,
        status,
        siiFormUrl: params.siiFormUrl,
      },
    });

    return true;
  }

  private monthName(m: number): string {
    return ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][m - 1];
  }
}
