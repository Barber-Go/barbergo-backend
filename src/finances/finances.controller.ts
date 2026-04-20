import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { FinancesService } from './finances.service';
import { MonthlySummaryQueryDto } from './dto/monthly-summary-query.dto';
import { DailyLedgerQueryDto } from './dto/daily-ledger-query.dto';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  ExpenseListQueryDto,
  FinanceSummaryQueryDto,
  LedgerMonthQueryDto,
} from './dto/create-expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/finances')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BARBERSHOP_OWNER)
export class FinancesController {
  constructor(private readonly financesService: FinancesService) {}

  @Get('summary')
  getSummary(@Request() req: { user: { id: string } }, @Query() q: FinanceSummaryQueryDto) {
    return this.financesService.getSummary(req.user.id, q.period, q.barbershopId);
  }

  @Get('monthly-summary')
  getMonthlySummary(@Request() req: { user: { id: string } }, @Query() q: MonthlySummaryQueryDto) {
    return this.financesService.getMonthlySummary(req.user.id, q.year, q.month);
  }

  @Get('monthly/breakdown')
  getBreakdown(@Request() req: { user: { id: string } }, @Query() q: MonthlySummaryQueryDto) {
    return this.financesService.getBarberBreakdown(req.user.id, q.year, q.month);
  }

  @Get('daily-ledger')
  getDailyLedger(@Request() req: { user: { id: string } }, @Query() q: DailyLedgerQueryDto) {
    return this.financesService.getDailyLedger(req.user.id, q.date);
  }

  @Get('ledger')
  getMonthlyLedger(@Request() req: { user: { id: string } }, @Query() q: LedgerMonthQueryDto) {
    return this.financesService.getMonthlyLedger(req.user.id, q.barbershopId, q.month);
  }

  @Get('expenses')
  getExpenses(@Request() req: { user: { id: string } }, @Query() q: ExpenseListQueryDto) {
    return this.financesService.getExpenses(req.user.id, q.barbershopId, q.category, q.from, q.to);
  }

  @Post('expenses')
  createExpense(@Request() req: { user: { id: string } }, @Body() dto: CreateExpenseDto) {
    return this.financesService.createExpense(req.user.id, dto);
  }

  @Patch('expenses/:id')
  updateExpense(@Request() req: { user: { id: string } }, @Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.financesService.updateExpense(req.user.id, id, dto);
  }

  @Delete('expenses/:id')
  deleteExpense(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.financesService.deleteExpense(req.user.id, id);
  }
}
