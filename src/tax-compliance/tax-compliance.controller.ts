import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { TaxComplianceService } from './tax-compliance.service';
import { CreateTaxProfileDto } from './dto/create-tax-profile.dto';
import { UpdateTaxProfileDto } from './dto/update-tax-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/tax')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BARBERSHOP_OWNER)
export class TaxComplianceController {
  constructor(private readonly taxService: TaxComplianceService) {}

  @Get('profile/me')
  getProfile(@Request() req: { user: { id: string } }) {
    return this.taxService.getProfile(req.user.id);
  }

  @Post('profile/me')
  createProfile(@Request() req: { user: { id: string } }, @Body() dto: CreateTaxProfileDto) {
    return this.taxService.createProfile(req.user.id, dto);
  }

  @Patch('profile/me')
  updateProfile(@Request() req: { user: { id: string } }, @Body() dto: UpdateTaxProfileDto) {
    return this.taxService.updateProfile(req.user.id, dto);
  }

  @Get('obligations/me')
  getObligations(@Request() req: { user: { id: string } }, @Query('year') year: string) {
    return this.taxService.getObligations(req.user.id, Number(year) || new Date().getFullYear());
  }

  @Get('calendar/me')
  getCalendar(
    @Request() req: { user: { id: string } },
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const y = Number(year) || new Date().getFullYear();
    const m = Number(month) || new Date().getMonth() + 1;
    return this.taxService.getCalendar(req.user.id, y, m);
  }

  @Post('obligations/:id/mark-completed')
  markCompleted(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { notes?: string },
  ) {
    return this.taxService.markCompleted(req.user.id, id, body?.notes);
  }

  @Post('obligations/:id/mark-pending')
  markPending(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.taxService.markPending(req.user.id, id);
  }

  @Post('generate')
  regenerate(@Request() req: { user: { id: string } }) {
    return this.taxService.regenerateObligations(req.user.id);
  }

  @Get('history/me')
  getHistory(@Request() req: { user: { id: string } }, @Query('year') year: string) {
    return this.taxService.getHistory(req.user.id, Number(year) || new Date().getFullYear());
  }
}
