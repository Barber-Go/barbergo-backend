import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { FinancesService } from './finances.service';
import { MonthlySummaryQueryDto } from './dto/monthly-summary-query.dto';
import { DailyLedgerQueryDto } from './dto/daily-ledger-query.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/finances')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BARBERSHOP_OWNER)
export class FinancesController {
  constructor(private readonly financesService: FinancesService) {}

  @Get('monthly-summary')
  getMonthlySummary(@Request() req: any, @Query() q: MonthlySummaryQueryDto) {
    return this.financesService.getMonthlySummary(req.user.id, q.year, q.month);
  }

  @Get('daily-ledger')
  getDailyLedger(@Request() req: any, @Query() q: DailyLedgerQueryDto) {
    return this.financesService.getDailyLedger(req.user.id, q.date);
  }

  @Post('expenses')
  createExpense(@Request() req: any, @Body() dto: CreateExpenseDto) {
    return this.financesService.createExpense(req.user.id, dto);
  }
}
