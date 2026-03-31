import { Body, Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  findAll() {
    return this.communitiesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.communitiesService.findOne(id);
  }

  @Get(':id/posts')
  listPosts(@Param('id') id: string, @Query() q: ListPostsQueryDto) {
    return this.communitiesService.listPosts(id, q.page ?? 1, q.limit ?? 20);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Request() req: any, @Body() dto: CreateCommunityDto) {
    return this.communitiesService.create(req.user.id, dto);
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  join(@Request() req: any, @Param('id') id: string) {
    return this.communitiesService.join(req.user.id, id);
  }

  @Delete(':id/leave')
  @UseGuards(JwtAuthGuard)
  leave(@Request() req: any, @Param('id') id: string) {
    return this.communitiesService.leave(req.user.id, id);
  }

  @Post(':id/posts')
  @UseGuards(JwtAuthGuard)
  createPost(@Request() req: any, @Param('id') id: string, @Body() dto: CreatePostDto) {
    return this.communitiesService.createPost(req.user.id, id, dto);
  }
}
