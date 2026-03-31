import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreatePostDto } from './dto/create-post.dto';

@Injectable()
export class CommunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const rows = await this.prisma.client.community.findMany({
      where: { isPublic: true },
      include: { _count: { select: { memberships: true, posts: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
      coverUrl: c.coverUrl,
      memberCount: c._count.memberships,
      postCount: c._count.posts,
    }));
  }

  async findOne(id: string) {
    const c = await this.prisma.client.community.findUnique({
      where: { id },
      include: {
        tags: { select: { id: true, name: true } },
        _count: { select: { memberships: true, posts: true } },
      },
    });
    if (!c) throw new NotFoundException('Community not found');
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
      coverUrl: c.coverUrl,
      isPublic: c.isPublic,
      tags: c.tags,
      memberCount: c._count.memberships,
      postCount: c._count.posts,
    };
  }

  async create(userId: string, dto: CreateCommunityDto) {
    const community = await this.prisma.client.community.create({
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        coverUrl: dto.coverUrl,
        isPublic: dto.isPublic ?? true,
      },
    });

    // Auto-join creator as ADMIN
    await this.prisma.client.communityMembership.create({
      data: { communityId: community.id, userId, role: 'ADMIN' },
    });

    return this.findOne(community.id);
  }

  async join(userId: string, communityId: string) {
    const community = await this.prisma.client.community.findUnique({ where: { id: communityId } });
    if (!community) throw new NotFoundException('Community not found');

    await this.prisma.client.communityMembership.upsert({
      where: { communityId_userId: { communityId, userId } },
      create: { communityId, userId, role: 'MEMBER' },
      update: {},
    });
    return { message: 'Joined community' };
  }

  async leave(userId: string, communityId: string) {
    await this.prisma.client.communityMembership.deleteMany({
      where: { communityId, userId },
    });
    return { message: 'Left community' };
  }

  async listPosts(communityId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.client.communityPost.findMany({
        where: { communityId },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.client.communityPost.count({ where: { communityId } }),
    ]);

    return {
      data: data.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        imageUrl: p.imageUrl,
        isPinned: p.isPinned,
        author: p.author,
        createdAt: p.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async createPost(userId: string, communityId: string, dto: CreatePostDto) {
    const membership = await this.prisma.client.communityMembership.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    if (!membership) throw new BadRequestException('Must be a community member to post');

    const post = await this.prisma.client.communityPost.create({
      data: {
        communityId,
        authorId: userId,
        title: dto.title,
        body: dto.body,
        imageUrl: dto.imageUrl,
      },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    return {
      id: post.id,
      title: post.title,
      body: post.body,
      imageUrl: post.imageUrl,
      author: post.author,
      createdAt: post.createdAt.toISOString(),
    };
  }
}
