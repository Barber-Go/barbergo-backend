import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { FollowsService } from './follows.service';
import { FollowDto } from './dto/follow.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicEntityType } from '../generated/prisma/enums';

@Controller('v1/follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getFollowing(@Request() req: any) {
    return this.followsService.getFollowing(req.user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  follow(@Request() req: any, @Body() dto: FollowDto) {
    return this.followsService.follow(req.user.id, dto);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  unfollow(@Request() req: any, @Body() dto: FollowDto) {
    return this.followsService.unfollow(req.user.id, dto);
  }

  @Get(':followedType/:followedId')
  getFollowers(
    @Param('followedType') followedType: PublicEntityType,
    @Param('followedId') followedId: string,
  ) {
    return this.followsService.getFollowers(followedType, followedId);
  }
}
