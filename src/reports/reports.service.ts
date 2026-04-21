import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportTargetType, ReportReason } from '../generated/prisma/enums';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(reporterId: string, dto: {
    targetType: ReportTargetType;
    targetId: string;
    bookingId?: string;
    reason: ReportReason;
    comment?: string;
  }) {
    const report = await this.prisma.client.report.create({
      data: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        bookingId: dto.bookingId ?? null,
        reason: dto.reason,
        comment: dto.comment ?? null,
      },
    });

    // Notify admins
    const admins = await this.prisma.client.user.findMany({
      where: { role: 'ADMIN', deletedAt: null },
      select: { id: true },
    });

    for (const admin of admins) {
      this.notificationsService.create(
        admin.id,
        'GENERAL',
        'Nuevo reporte recibido',
        `Reporte de ${dto.reason} sobre ${dto.targetType} ${dto.targetId}`,
      ).catch(() => {});
    }

    return report;
  }
}
