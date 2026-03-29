import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

interface JwtUser {
  id: string;
  email: string;
  role: Role;
}

@Controller('v1/bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // POST /api/v1/bookings — client creates a booking
  @Post()
  @Roles(Role.CLIENT)
  create(@Request() req: { user: JwtUser }, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(req.user.id, dto);
  }

  // GET /api/v1/bookings/mine — returns bookings for the authenticated user
  // CLIENT → own bookings as client; BARBER → own bookings as barber
  @Get('mine')
  @Roles(Role.CLIENT, Role.BARBER)
  findMine(@Request() req: { user: JwtUser }) {
    if (req.user.role === Role.BARBER) {
      return this.bookingsService.findForBarber(req.user.id);
    }
    return this.bookingsService.findForClient(req.user.id);
  }

  // GET /api/v1/bookings/:id — single booking (owner or admin)
  @Get(':id')
  @Roles(Role.CLIENT, Role.BARBER, Role.ADMIN)
  findOne(@Param('id') id: string, @Request() req: { user: JwtUser }) {
    return this.bookingsService.findOne(id, req.user.id, req.user.role);
  }

  // PATCH /api/v1/bookings/:id/status — update status
  @Patch(':id/status')
  @Roles(Role.CLIENT, Role.BARBER, Role.ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
    @Request() req: { user: JwtUser },
  ) {
    return this.bookingsService.updateStatus(id, dto, req.user.id, req.user.role);
  }
}
