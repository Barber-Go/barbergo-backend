import { Controller, Get, Param, Patch, Request, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Request() req: any) {
    return this.notificationsService.findAllForUser(req.user.id);
  }

  @Get('unread-count')
  @UseGuards(JwtAuthGuard)
  unreadCount(@Request() req: any) {
    return this.notificationsService
      .countUnread(req.user.id)
      .then((count) => ({ count }));
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.notificationsService.markAsRead(id, req.user.id);
  }
}
