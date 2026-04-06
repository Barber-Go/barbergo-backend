import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaxObligationEngineService } from './tax-obligation-engine.service';
import { CreateTaxProfileDto } from './dto/create-tax-profile.dto';
import { UpdateTaxProfileDto } from './dto/update-tax-profile.dto';

@Injectable()
export class TaxComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: TaxObligationEngineService,
  ) {}

  // ── Profile ───────────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const shop = await this.assertOwner(userId);
    const profile = await this.prisma.client.taxProfile.findUnique({
      where: { barbershopId: shop.id },
    });
    return profile;
  }

  async createProfile(userId: string, dto: CreateTaxProfileDto) {
    const shop = await this.assertOwner(userId);

    const profileData = {
      rut: dto.rut,
      razonSocial: dto.razonSocial,
      giro: dto.giro,
      regimenTributario: dto.regimenTributario,
      vatAffectation: dto.vatAffectation,
      issuesDte: dto.issuesDte,
      hasEmployees: dto.hasEmployees,
      withholdsHonorarios: dto.withholdsHonorarios,
      monthlyRevenue: dto.monthlyRevenue,
      pfxCertificateBase64: dto.pfxCertificateBase64,
      pfxPassword: dto.pfxPassword,
      siiResolucionNumero: dto.siiResolucionNumero,
      siiResolucionFecha: dto.siiResolucionFecha ? new Date(dto.siiResolucionFecha) : undefined,
      comunaSii: dto.comunaSii,
      direccionSii: dto.direccionSii,
      actividadEconomica: dto.actividadEconomica,
      wizardCompletedAt: new Date(),
    };

    const profile = await this.prisma.client.taxProfile.upsert({
      where: { barbershopId: shop.id },
      create: { barbershopId: shop.id, ...profileData },
      update: profileData,
    });

    // Generate obligations for current year
    const year = new Date().getFullYear();
    await this.engine.generateForYear({
      taxProfileId: profile.id,
      vatAffectation: profile.vatAffectation,
      issuesDte: profile.issuesDte,
      hasEmployees: profile.hasEmployees,
      withholdsHonorarios: profile.withholdsHonorarios,
    }, year);

    return profile;
  }

  async updateProfile(userId: string, dto: UpdateTaxProfileDto) {
    const shop = await this.assertOwner(userId);
    const existing = await this.prisma.client.taxProfile.findUnique({
      where: { barbershopId: shop.id },
    });
    if (!existing) throw new NotFoundException('Perfil tributario no encontrado');

    const { siiResolucionFecha, ...rest } = dto;
    const profile = await this.prisma.client.taxProfile.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(siiResolucionFecha !== undefined && {
          siiResolucionFecha: new Date(siiResolucionFecha),
        }),
        updatedAt: new Date(),
      },
    });

    return profile;
  }

  // ── Obligations ───────────────────────────────────────────────────────────

  async getObligations(userId: string, year: number) {
    const shop = await this.assertOwner(userId);
    const profile = await this.prisma.client.taxProfile.findUnique({
      where: { barbershopId: shop.id },
    });
    if (!profile) return [];

    return this.prisma.client.taxObligation.findMany({
      where: {
        taxProfileId: profile.id,
        period: { startsWith: String(year) },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async getCalendar(userId: string, year: number, month: number) {
    const shop = await this.assertOwner(userId);
    const profile = await this.prisma.client.taxProfile.findUnique({
      where: { barbershopId: shop.id },
    });
    if (!profile) return [];

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    return this.prisma.client.taxObligation.findMany({
      where: {
        taxProfileId: profile.id,
        dueDate: { gte: startDate, lte: endDate },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async markCompleted(userId: string, obligationId: string, notes?: string) {
    const shop = await this.assertOwner(userId);
    const obligation = await this.prisma.client.taxObligation.findUnique({
      where: { id: obligationId },
      include: { taxProfile: true },
    });
    if (!obligation || obligation.taxProfile.barbershopId !== shop.id) {
      throw new NotFoundException('Obligación no encontrada');
    }

    const updated = await this.prisma.client.taxObligation.update({
      where: { id: obligationId },
      data: { status: 'COMPLETED', completedAt: new Date(), notes },
    });

    await this.prisma.client.taxDeclarationLog.create({
      data: {
        obligationId,
        action: 'MARKED_COMPLETED',
        performedBy: userId,
        metadata: notes ? { notes } : undefined,
      },
    });

    return updated;
  }

  async markPending(userId: string, obligationId: string) {
    const shop = await this.assertOwner(userId);
    const obligation = await this.prisma.client.taxObligation.findUnique({
      where: { id: obligationId },
      include: { taxProfile: true },
    });
    if (!obligation || obligation.taxProfile.barbershopId !== shop.id) {
      throw new NotFoundException('Obligación no encontrada');
    }

    const now = new Date();
    const status = obligation.dueDate < now ? 'OVERDUE' : 'PENDING';

    const updated = await this.prisma.client.taxObligation.update({
      where: { id: obligationId },
      data: { status, completedAt: null, notes: null },
    });

    await this.prisma.client.taxDeclarationLog.create({
      data: {
        obligationId,
        action: 'MARKED_PENDING',
        performedBy: userId,
      },
    });

    return updated;
  }

  async regenerateObligations(userId: string) {
    const shop = await this.assertOwner(userId);
    const profile = await this.prisma.client.taxProfile.findUnique({
      where: { barbershopId: shop.id },
    });
    if (!profile) throw new NotFoundException('Perfil tributario no encontrado');

    const year = new Date().getFullYear();
    const generated = await this.engine.generateForYear({
      taxProfileId: profile.id,
      vatAffectation: profile.vatAffectation,
      issuesDte: profile.issuesDte,
      hasEmployees: profile.hasEmployees,
      withholdsHonorarios: profile.withholdsHonorarios,
    }, year);

    return { generated };
  }

  // ── History ───────────────────────────────────────────────────────────────

  async getHistory(userId: string, year: number) {
    const shop = await this.assertOwner(userId);
    const profile = await this.prisma.client.taxProfile.findUnique({
      where: { barbershopId: shop.id },
    });
    if (!profile) return [];

    return this.prisma.client.taxDeclarationLog.findMany({
      where: {
        obligation: {
          taxProfileId: profile.id,
          period: { startsWith: String(year) },
        },
      },
      include: {
        obligation: { select: { type: true, name: true, period: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async assertOwner(userId: string) {
    const shop = await this.prisma.client.barbershopProfile.findUnique({ where: { userId } });
    if (!shop) throw new NotFoundException('Barbershop profile not found');
    return shop;
  }
}
