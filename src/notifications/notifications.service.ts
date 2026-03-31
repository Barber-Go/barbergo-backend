import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '../generated/prisma/enums';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, type: NotificationType, title: string, body: string) {
    return this.prisma.client.notification.create({
      data: { userId, type, title, body },
    });
  }

  async findAllForUser(userId: string) {
    const rows = await this.prisma.client.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async markAsRead(id: string, userId: string) {
    await this.prisma.client.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    return { success: true };
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.client.notification.count({
      where: { userId, isRead: false },
    });
  }
}
