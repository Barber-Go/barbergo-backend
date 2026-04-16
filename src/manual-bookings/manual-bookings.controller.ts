import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Request, UseGuards,
} from '@nestjs/common';
import { ManualBookingsService } from './manual-bookings.service';
import { CreateManualBookingDto } from './dto/create-manual-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1')
export class ManualBookingsController {
  constructor(private readonly service: ManualBookingsService) {}

  // ── Manual bookings CRUD ──────────────────────────────────────────────────

  @Post('manual-bookings')
  @UseGuards(JwtAuthGuard)
  create(@Request() req: { user: { id: string } }, @Body() dto: CreateManualBookingDto) {
    return this.service.create(req.user.id, dto);
  }

  @Get('manual-bookings/my')
  @UseGuards(JwtAuthGuard)
  findMy(@Request() req: { user: { id: string } }, @Query('date') date: string) {
    return this.service.findByDate(req.user.id, date);
  }

  @Patch('manual-bookings/:id')
  @UseGuards(JwtAuthGuard)
  update(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: Partial<CreateManualBookingDto>,
  ) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete('manual-bookings/:id')
  @UseGuards(JwtAuthGuard)
  remove(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }

  // ── Agenda (public) ───────────────────────────────────────────────────────

  @Get('agenda/:barberId/day')
  getDayAgenda(@Param('barberId') barberId: string, @Query('date') date: string) {
    return this.service.getDayAgenda(barberId, date);
  }

  @Get('agenda/:barberId/week')
  getWeekAgenda(@Param('barberId') barberId: string, @Query('startDate') startDate: string) {
    return this.service.getWeekAgenda(barberId, startDate);
  }
}
