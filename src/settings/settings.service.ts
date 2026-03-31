import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const DEFAULTS = {
  pushNotifications: true,
  emailNotifications: true,
  language: 'es',
  currency: 'CLP',
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const row = await this.prisma.client.userSettings.findUnique({ where: { userId } });
    if (!row) return { userId, ...DEFAULTS };
    return this.format(row);
  }

  async upsert(userId: string, dto: UpdateSettingsDto) {
    const row = await this.prisma.client.userSettings.upsert({
      where: { userId },
      create: { userId, ...DEFAULTS, ...dto },
      update: { ...dto },
    });
    return this.format(row);
  }

  private format(row: any) {
    return {
      pushNotifications: row.pushNotifications,
      emailNotifications: row.emailNotifications,
      language: row.language,
      currency: row.currency,
    };
  }
}
