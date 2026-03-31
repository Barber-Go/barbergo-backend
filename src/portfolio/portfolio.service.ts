import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from './media-storage.service';
import { CreatePortfolioItemDto, AddMediaDto } from './dto/create-portfolio-item.dto';
import { UpdatePortfolioItemDto } from './dto/update-portfolio-item.dto';

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaStorageService,
  ) {}

  async findByBarberId(barberId: string) {
    const items = await this.prisma.client.barberPortfolioItem.findMany({
      where: { barberId },
      include: { media: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((i) => this.formatItem(i));
  }

  async create(userId: string, dto: CreatePortfolioItemDto) {
    const profile = await this.getProfile(userId);

    const item = await this.prisma.client.barberPortfolioItem.create({
      data: {
        barberId: profile.id,
        title: dto.title,
        description: dto.description,
        media: dto.media?.length
          ? { create: dto.media.map((m) => ({ type: m.type, url: m.url, thumbnailUrl: m.thumbnailUrl, sortOrder: m.sortOrder ?? 0 })) }
          : undefined,
      },
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    });

    return this.formatItem(item);
  }

  async update(userId: string, itemId: string, dto: UpdatePortfolioItemDto) {
    await this.assertOwnership(userId, itemId);
    const item = await this.prisma.client.barberPortfolioItem.update({
      where: { id: itemId },
      data: { title: dto.title, description: dto.description },
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    });
    return this.formatItem(item);
  }

  async addMedia(userId: string, itemId: string, dto: AddMediaDto) {
    await this.assertOwnership(userId, itemId);
    const url = await this.media.upload(dto.url);
    const m = await this.prisma.client.barberPortfolioMedia.create({
      data: { portfolioItemId: itemId, type: dto.type, url, thumbnailUrl: dto.thumbnailUrl, sortOrder: dto.sortOrder ?? 0 },
    });
    return { id: m.id, type: m.type, url: m.url, thumbnailUrl: m.thumbnailUrl, sortOrder: m.sortOrder };
  }

  async removeMedia(userId: string, mediaId: string) {
    const m = await this.prisma.client.barberPortfolioMedia.findUnique({
      where: { id: mediaId },
      include: { portfolioItem: true },
    });
    if (!m) throw new NotFoundException('Media not found');
    await this.assertOwnership(userId, m.portfolioItemId);
    await this.prisma.client.barberPortfolioMedia.delete({ where: { id: mediaId } });
    return { message: 'Media deleted' };
  }

  async deleteItem(userId: string, itemId: string) {
    await this.assertOwnership(userId, itemId);
    await this.prisma.client.barberPortfolioMedia.deleteMany({ where: { portfolioItemId: itemId } });
    await this.prisma.client.barberPortfolioItem.delete({ where: { id: itemId } });
    return { message: 'Portfolio item deleted' };
  }

  // ── Helpers ──

  private async getProfile(userId: string) {
    const p = await this.prisma.client.barberProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Barber profile not found');
    return p;
  }

  private async assertOwnership(userId: string, itemId: string) {
    const profile = await this.getProfile(userId);
    const item = await this.prisma.client.barberPortfolioItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Portfolio item not found');
    if (item.barberId !== profile.id) throw new ForbiddenException();
  }

  private formatItem(item: any) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      createdAt: item.createdAt.toISOString(),
      media: item.media.map((m: any) => ({
        id: m.id,
        type: m.type,
        url: m.url,
        thumbnailUrl: m.thumbnailUrl,
        sortOrder: m.sortOrder,
      })),
    };
  }
}
