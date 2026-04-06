import {
  Controller,
  Get,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BARBERSHOP_OWNER)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('monthly')
  getMonthly(
    @Request() req: { user: { id: string } },
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const y = Number(year) || new Date().getFullYear();
    const m = Number(month) || new Date().getMonth() + 1;
    return this.billingService.getMonthly(req.user.id, y, m);
  }

  @Get('summary')
  getSummary(
    @Request() req: { user: { id: string } },
    @Query('year') year: string,
  ) {
    const y = Number(year) || new Date().getFullYear();
    return this.billingService.getSummary(req.user.id, y);
  }
}
