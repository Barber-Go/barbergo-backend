import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MESSAGES_PER_PAGE = 50;
const CHAT_LOCK_HOURS = 24;

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List threads for user ─────────────────────────────────────────────────

  async listThreads(userId: string) {
    const participants = await this.prisma.client.chatParticipant.findMany({
      where: { userId },
      include: {
        thread: {
          include: {
            participants: {
              include: { user: { select: { id: true, name: true, avatarUrl: true } } },
            },
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            booking: {
              select: {
                id: true,
                status: true,
                scheduledAt: true,
                service: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { thread: { createdAt: 'desc' } },
    });

    return participants.map((p) => {
      const thread = p.thread;
      const lastMessage = thread.messages[0] ?? null;
      const otherParticipants = thread.participants
        .filter((tp) => tp.userId !== userId)
        .map((tp) => tp.user);

      // Count unread
      const unread = thread.messages.length > 0 && lastMessage
        ? (lastMessage.createdAt > p.lastReadAt ? 1 : 0)
        : 0;

      return {
        id: thread.id,
        threadType: thread.threadType,
        status: thread.status,
        booking: thread.booking,
        otherParticipants,
        lastMessage: lastMessage
          ? {
              body: lastMessage.body,
              messageType: lastMessage.messageType,
              senderId: lastMessage.senderId,
              createdAt: lastMessage.createdAt,
            }
          : null,
        unreadCount: unread,
        createdAt: thread.createdAt,
      };
    });
  }

  // ── Get unread count across all threads ───────────────────────────────────

  async getUnreadCount(userId: string): Promise<number> {
    const participants = await this.prisma.client.chatParticipant.findMany({
      where: { userId },
      select: {
        lastReadAt: true,
        thread: {
          select: {
            status: true,
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });

    let count = 0;
    for (const p of participants) {
      if (p.thread.status !== 'OPEN') continue;
      const last = p.thread.messages[0];
      if (last && last.createdAt > p.lastReadAt) count++;
    }
    return count;
  }

  // ── Get messages for thread ───────────────────────────────────────────────

  async getMessages(userId: string, threadId: string, cursor?: string) {
    await this.assertParticipant(userId, threadId);

    const messages = await this.prisma.client.chatMessage.findMany({
      where: { threadId, deletedAt: null, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: MESSAGES_PER_PAGE,
      include: {
        sender: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Get thread info
    const thread = await this.prisma.client.chatThread.findUnique({
      where: { id: threadId },
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            scheduledAt: true,
            service: { select: { name: true } },
          },
        },
        participants: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        },
      },
    });

    return {
      messages: messages.reverse(),
      thread: {
        id: thread!.id,
        status: thread!.status,
        threadType: thread!.threadType,
        booking: thread!.booking,
        participants: thread!.participants.map((p) => ({
          userId: p.userId,
          name: p.user.name,
          avatarUrl: p.user.avatarUrl,
          roleInThread: p.roleInThread,
        })),
      },
      hasMore: messages.length === MESSAGES_PER_PAGE,
    };
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async sendMessage(userId: string, threadId: string, body: string) {
    const participant = await this.assertParticipant(userId, threadId);
    await this.assertCanSend(participant.thread);

    const message = await this.prisma.client.chatMessage.create({
      data: {
        threadId,
        senderId: userId,
        messageType: 'TEXT',
        body,
      },
      include: {
        sender: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Update sender's lastReadAt
    await this.prisma.client.chatParticipant.update({
      where: { threadId_userId: { threadId, userId } },
      data: { lastReadAt: new Date() },
    });

    return message;
  }

  // ── Create or get thread for booking ──────────────────────────────────────

  async getOrCreateThreadForBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      include: {
        barber: { select: { userId: true } },
        service: { select: { name: true } },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    // Only client or barber of this booking can create thread
    const barberUserId = booking.barber.userId;
    if (userId !== booking.clientId && userId !== barberUserId) {
      throw new ForbiddenException('No tienes acceso a esta reserva');
    }

    // Check existing thread
    const existing = await this.prisma.client.chatThread.findUnique({
      where: { bookingId },
    });

    if (existing) return { threadId: existing.id, created: false };

    // Determine roles
    const clientRole = 'CLIENT';
    const barberRole = 'BARBER';

    const thread = await this.prisma.client.chatThread.create({
      data: {
        bookingId,
        threadType: 'BOOKING_DIRECT',
        status: 'OPEN',
        participants: {
          create: [
            { userId: booking.clientId, roleInThread: clientRole },
            { userId: barberUserId, roleInThread: barberRole },
          ],
        },
        messages: {
          create: {
            senderId: userId,
            messageType: 'SYSTEM',
            body: `Chat iniciado para ${booking.service.name}`,
          },
        },
      },
    });

    return { threadId: thread.id, created: true };
  }

  // ── Create thread automatically (called from bookings service) ────────────

  async createThreadForBooking(bookingId: string, clientId: string, barberUserId: string, serviceName: string) {
    const existing = await this.prisma.client.chatThread.findUnique({
      where: { bookingId },
    });
    if (existing) return existing;

    return this.prisma.client.chatThread.create({
      data: {
        bookingId,
        threadType: 'BOOKING_DIRECT',
        status: 'OPEN',
        participants: {
          create: [
            { userId: clientId, roleInThread: 'CLIENT' },
            { userId: barberUserId, roleInThread: 'BARBER' },
          ],
        },
        messages: {
          create: {
            senderId: clientId,
            messageType: 'SYSTEM',
            body: 'Reserva confirmada',
          },
        },
      },
    });
  }

  // ── Send system message (called from bookings service) ────────────────────

  async sendSystemMessage(bookingId: string, body: string) {
    const thread = await this.prisma.client.chatThread.findUnique({
      where: { bookingId },
      include: { participants: true },
    });
    if (!thread) return;

    const senderId = thread.participants[0]?.userId;
    if (!senderId) return;

    await this.prisma.client.chatMessage.create({
      data: {
        threadId: thread.id,
        senderId,
        messageType: 'SYSTEM',
        body,
      },
    });
  }

  // ── Mark as read ──────────────────────────────────────────────────────────

  async markAsRead(userId: string, threadId: string) {
    await this.assertParticipant(userId, threadId);

    await this.prisma.client.chatParticipant.update({
      where: { threadId_userId: { threadId, userId } },
      data: { lastReadAt: new Date() },
    });

    return { success: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async assertParticipant(userId: string, threadId: string) {
    const participant = await this.prisma.client.chatParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
      include: { thread: { include: { booking: true } } },
    });

    if (!participant) {
      throw new ForbiddenException('No eres participante de esta conversación');
    }

    return participant;
  }

  private async assertCanSend(thread: { status: string; booking?: { status: string; updatedAt: Date } | null }) {
    if (thread.status !== 'OPEN') {
      throw new BadRequestException('Esta conversación está cerrada');
    }

    if (thread.booking) {
      const { status, updatedAt } = thread.booking;
      if (status === 'CANCELLED') {
        throw new BadRequestException('No puedes enviar mensajes en una reserva cancelada');
      }
      if (status === 'COMPLETED') {
        const hoursSince = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSince > CHAT_LOCK_HOURS) {
          throw new BadRequestException('El chat se cerró 24 horas después de completar la reserva');
        }
      }
    }
  }
}
