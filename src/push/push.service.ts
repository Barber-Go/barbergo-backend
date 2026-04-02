import { Injectable } from '@nestjs/common';
import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PushService {
  private readonly expo = new Expo();

  constructor(private readonly prisma: PrismaService) {}

  async registerToken(userId: string, token: string) {
    if (!Expo.isExpoPushToken(token)) {
      throw new Error('Invalid Expo push token');
    }

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { pushToken: token },
    });
  }

  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    });

    if (!user?.pushToken || !Expo.isExpoPushToken(user.pushToken)) return;

    const message: ExpoPushMessage = {
      to: user.pushToken,
      sound: 'default',
      title,
      body,
      data: data ?? {},
    };

    try {
      await this.expo.sendPushNotificationsAsync([message]);
    } catch {
      // Silent fail — push is best-effort
    }
  }
}
