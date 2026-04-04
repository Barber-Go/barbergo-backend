import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Response } from 'express';
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

  @Get('boletas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT)
  listarBoletas(
    @Request() req: any,
    @Query('mes') mes: string,
    @Query('anio') anio: string,
  ) {
    const now = new Date();
    const m = mes ? parseInt(mes, 10) : now.getMonth() + 1;
    const a = anio ? parseInt(anio, 10) : now.getFullYear();
    return this.siiService.listarBoletas(req.user.id, m, a);
  }

  @Get('boletas/:id/pdf')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT)
  async getBoletaPdf(
    @Request() req: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, folio } = await this.siiService.getBoletaPdf(req.user.id, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="boleta-${folio}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Post('boletas/:id/anular')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT)
  anularBoleta(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { folio: string; causa?: number },
  ) {
    return this.siiService.anularBoleta(req.user.id, id, body);
  }
}
