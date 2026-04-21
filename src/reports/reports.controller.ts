import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../generated/prisma/enums';

interface JwtUser { id: string; email: string; role: Role }

@Controller('v1/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  async create(
    @Body() dto: CreateReportDto,
    @Request() req: { user: JwtUser },
  ) {
    const data = await this.reportsService.create(req.user.id, dto);
    return { data, message: 'Reporte enviado', statusCode: 201 };
  }
}
