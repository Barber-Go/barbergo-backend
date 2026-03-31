import { Body, Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { MonthQueryDto, SlotsQueryDto } from './dto/month-query.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  // ── Public ──

  @Get(':barberId/month')
  getBookableDates(@Param('barberId') barberId: string, @Query() q: MonthQueryDto) {
    return this.availabilityService.getBookableDates(barberId, q.year, q.month);
  }

  @Get(':barberId/slots')
  getSlots(@Param('barberId') barberId: string, @Query() q: SlotsQueryDto) {
    return this.availabilityService.getSlots(barberId, q.date);
  }

  // ── Barber-protected ──

  @Post('blocks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  createBlock(@Request() req: any, @Body() dto: CreateBlockDto) {
    return this.availabilityService.createBlock(req.user.id, dto);
  }

  @Delete('blocks/:blockId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  deleteBlock(@Request() req: any, @Param('blockId') blockId: string) {
    return this.availabilityService.deleteBlock(req.user.id, blockId);
  }
}
