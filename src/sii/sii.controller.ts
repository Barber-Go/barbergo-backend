import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SiiService } from './sii.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/sii')
export class SiiController {
  constructor(private readonly siiService: SiiService) {}

  @Post('boleta')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT)
  emitirBoleta(@Request() req: any, @Body() body: { bookingId: string }) {
    return this.siiService.emitirBoletaParaBooking(req.user.id, body.bookingId);
  }

  @Get('boleta/:bookingId')
  @UseGuards(JwtAuthGuard)
  getBoletaStatus(@Param('bookingId') bookingId: string) {
    return this.siiService.getBoletaByBooking(bookingId);
  }
}
