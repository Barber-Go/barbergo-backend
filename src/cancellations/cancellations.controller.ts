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
import { CancellationsService } from './cancellations.service';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role, SuspensionLevel } from '../generated/prisma/enums';

interface JwtUser {
  id: string;
  email: string;
  role: Role;
}

@Controller('v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CancellationsController {
  constructor(private readonly cancellationsService: CancellationsService) {}

  // PATCH /api/v1/bookings/:id/cancel
  @Patch('bookings/:id/cancel')
  @Roles(Role.CLIENT, Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE, Role.BARBERSHOP_OWNER, Role.ADMIN)
  async cancelBooking(
    @Param('id') bookingId: string,
    @Body() dto: CancelBookingDto,
    @Request() req: { user: JwtUser },
  ) {
    const data = await this.cancellationsService.cancelBooking(
      bookingId,
      req.user.id,
      req.user.role,
      dto.reason,
      dto.notes,
    );
    return { data, message: 'Reserva cancelada', statusCode: 200 };
  }

  // GET /api/v1/bookings/:id/cancellation-policy
  @Get('bookings/:id/cancellation-policy')
  @Roles(Role.CLIENT, Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE, Role.BARBERSHOP_OWNER, Role.ADMIN)
  async getCancellationPolicy(
    @Param('id') bookingId: string,
    @Request() req: { user: JwtUser },
  ) {
    const data = await this.cancellationsService.getCancellationPolicy(
      bookingId,
      req.user.id,
      req.user.role,
    );
    return { data, message: 'Política de cancelación', statusCode: 200 };
  }

  // GET /api/v1/providers/me/cancellation-stats
  @Get('providers/me/cancellation-stats')
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE, Role.BARBERSHOP_OWNER)
  async getMyStats(@Request() req: { user: JwtUser }) {
    const data = await this.cancellationsService.getProviderStats(req.user.id);
    return { data, message: 'Estadísticas de cancelación', statusCode: 200 };
  }

  // GET /api/v1/providers/:id/public-stats
  @Get('providers/:id/public-stats')
  async getPublicStats(@Param('id') barberProfileId: string) {
    const data = await this.cancellationsService.getPublicStats(barberProfileId);
    return { data, message: 'Estadísticas públicas', statusCode: 200 };
  }

  // POST /api/v1/admin/providers/:userId/suspend
  @Post('admin/providers/:userId/suspend')
  @Roles(Role.ADMIN)
  async adminSuspend(
    @Param('userId') providerUserId: string,
    @Body() body: { level: SuspensionLevel; reason: string },
    @Request() req: { user: JwtUser },
  ) {
    const data = await this.cancellationsService.adminSuspend(
      providerUserId,
      body.level,
      body.reason,
      req.user.id,
    );
    return { data, message: 'Proveedor suspendido', statusCode: 201 };
  }

  // POST /api/v1/admin/suspensions/:id/resolve
  @Post('admin/suspensions/:id/resolve')
  @Roles(Role.ADMIN)
  async adminResolve(
    @Param('id') suspensionId: string,
    @Request() req: { user: JwtUser },
  ) {
    const data = await this.cancellationsService.adminResolve(suspensionId, req.user.id);
    return { data, message: 'Suspensión levantada', statusCode: 200 };
  }
}
