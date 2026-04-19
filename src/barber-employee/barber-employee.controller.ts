import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { BarberEmployeeService } from './barber-employee.service';
import { EmployeeDashboardQueryDto } from './dto/dashboard-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/barber-employee')
export class BarberEmployeeController {
  constructor(private readonly service: BarberEmployeeService) {}

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER_EMPLOYEE)
  getDashboard(@Request() req: { user: { id: string } }, @Query() query: EmployeeDashboardQueryDto) {
    return this.service.getDashboard(req.user.id, query.period);
  }
}
