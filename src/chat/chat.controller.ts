import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('threads')
  listThreads(@Request() req: any) {
    return this.chatService.listThreads(req.user.id);
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any) {
    const count = await this.chatService.getUnreadCount(req.user.id);
    return { count };
  }

  @Get('threads/:id')
  getMessages(
    @Request() req: any,
    @Param('id') threadId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.chatService.getMessages(req.user.id, threadId, cursor);
  }

  @Post('threads/:id/messages')
  sendMessage(
    @Request() req: any,
    @Param('id') threadId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(req.user.id, threadId, dto.body);
  }

  @Post('bookings/:bookingId/thread')
  createThread(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
  ) {
    return this.chatService.getOrCreateThreadForBooking(req.user.id, bookingId);
  }

  @Patch('threads/:id/read')
  @HttpCode(HttpStatus.OK)
  markAsRead(@Request() req: any, @Param('id') threadId: string) {
    return this.chatService.markAsRead(req.user.id, threadId);
  }
}
