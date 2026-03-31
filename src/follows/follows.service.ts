import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FollowDto } from './dto/follow.dto';
import { PublicEntityType } from '../generated/prisma/enums';

@Injectable()
export class FollowsService {
  constructor(private readonly prisma: PrismaService) {}

  async follow(followerId: string, dto: FollowDto) {
    try {
      const row = await this.prisma.client.follow.create({
        data: {
          followerId,
          followedType: dto.followedType,
          followedId: dto.followedId,
        },
      });
      return { id: row.id, followedType: row.followedType, followedId: row.followedId };
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Already following');
      throw e;
    }
  }

  async unfollow(followerId: string, dto: FollowDto) {
    await this.prisma.client.follow.deleteMany({
      where: {
        followerId,
        followedType: dto.followedType,
        followedId: dto.followedId,
      },
    });
    return { message: 'Unfollowed' };
  }

  async getFollowing(userId: string) {
    const rows = await this.prisma.client.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      followedType: r.followedType,
      followedId: r.followedId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getFollowers(followedType: PublicEntityType, followedId: string) {
    const rows = await this.prisma.client.follow.findMany({
      where: { followedType, followedId },
      include: { follower: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      follower: r.follower,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
