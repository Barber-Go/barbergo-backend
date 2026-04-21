import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { TipsService } from './tips.service';
import { CreateTipDto } from './dto/create-tip.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

interface JwtUser {
  id: string;
  email: string;
  role: Role;
}

@Controller('v1/tips')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TipsController {
  constructor(private readonly tipsService: TipsService) {}

  // GET /api/v1/tips/suggested-amounts?bookingId=xxx
  @Get('suggested-amounts')
  @Roles(Role.CLIENT)
  async getSuggestedAmounts(
    @Query('bookingId') bookingId: string,
    @Request() req: { user: JwtUser },
  ) {
    const data = await this.tipsService.getSuggestedAmounts(bookingId, req.user.id);
    return { data, message: 'Opciones de propina', statusCode: 200 };
  }

  // POST /api/v1/tips
  @Post()
  @Roles(Role.CLIENT)
  async createTip(
    @Body() dto: CreateTipDto,
    @Request() req: { user: JwtUser },
  ) {
    const data = await this.tipsService.createTip(req.user.id, dto);
    return { data, message: 'Propina registrada', statusCode: 201 };
  }

  // GET /api/v1/tips/booking/:bookingId
  @Get('booking/:bookingId')
  async getTipByBooking(@Param('bookingId') bookingId: string) {
    const data = await this.tipsService.getTipByBooking(bookingId);
    return { data, message: 'Propina de reserva', statusCode: 200 };
  }

  // GET /api/v1/tips/mine/received?from=xxx&to=xxx
  @Get('mine/received')
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  async getReceivedTips(
    @Request() req: { user: JwtUser },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.tipsService.getReceivedTips(req.user.id, from, to);
    return { data, message: 'Propinas recibidas', statusCode: 200 };
  }

  // GET /api/v1/tips/mine/monthly-total
  @Get('mine/monthly-total')
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  async getMonthlyTotal(@Request() req: { user: JwtUser }) {
    const data = await this.tipsService.getMonthlyTipsTotal(req.user.id);
    return { data, message: 'Propinas del mes', statusCode: 200 };
  }
}
