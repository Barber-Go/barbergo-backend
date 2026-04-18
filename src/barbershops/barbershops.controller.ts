import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { BarbershopsService } from './barbershops.service';
import { CreateBarbershopDto } from './dto/create-barbershop.dto';
import { UpdateBarbershopDto } from './dto/update-barbershop.dto';
import { AddStaffDto } from './dto/add-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { TeamQueryDto } from './dto/team-query.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/barbershops')
export class BarbershopsController {
  constructor(private readonly barbershopsService: BarbershopsService) {}

  // ── Owner-protected (before :id to avoid route clash) ──

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  findMe(@Request() req: any) {
    return this.barbershopsService.findMe(req.user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  create(@Request() req: any, @Body() dto: CreateBarbershopDto) {
    return this.barbershopsService.create(req.user.id, dto);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  update(@Request() req: any, @Body() dto: UpdateBarbershopDto) {
    return this.barbershopsService.update(req.user.id, dto);
  }

  @Get('me/invite-code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  getInviteCode(@Request() req: any) {
    return this.barbershopsService.getOrCreateInviteCode(req.user.id);
  }

  @Get('me/search-barber')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  searchBarberByEmail(@Query('email') email: string) {
    return this.barbershopsService.searchBarberByEmail(email);
  }

  @Post('me/staff')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  addStaff(@Request() req: any, @Body() dto: AddStaffDto) {
    return this.barbershopsService.addStaff(req.user.id, dto);
  }

  @Patch('me/staff/:memberId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  updateStaff(@Request() req: any, @Param('memberId') memberId: string, @Body() dto: UpdateStaffDto) {
    return this.barbershopsService.updateStaff(req.user.id, memberId, dto);
  }

  @Delete('me/staff/:memberId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  removeStaff(@Request() req: any, @Param('memberId') memberId: string) {
    return this.barbershopsService.removeStaff(req.user.id, memberId);
  }

  @Get('me/schedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  getSchedule(@Request() req: { user: { id: string } }) {
    return this.barbershopsService.getSchedule(req.user.id);
  }

  @Patch('me/schedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  updateSchedule(@Request() req: { user: { id: string } }, @Body() body: { schedule: Record<string, { start: string; end: string }[]> }) {
    return this.barbershopsService.updateSchedule(req.user.id, body.schedule);
  }

  @Patch('staff/:barberId/availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  updateStaffAvailability(
    @Request() req: { user: { id: string } },
    @Param('barberId') barberId: string,
    @Body() body: { slots: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[] },
  ) {
    return this.barbershopsService.updateStaffAvailability(req.user.id, barberId, body.slots);
  }

  // ── Team ──

  @Get('team')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  getTeam(@Request() req: { user: { id: string } }, @Query() query: TeamQueryDto) {
    return this.barbershopsService.getTeam(req.user.id, query.scope, query.period);
  }

  @Get('team/invitations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  getInvitations(@Request() req: { user: { id: string } }, @Query('barbershopId') barbershopId?: string) {
    return this.barbershopsService.getInvitations(req.user.id, barbershopId);
  }

  @Post('team/invitations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  createInvitation(@Request() req: { user: { id: string } }, @Body() dto: CreateInvitationDto) {
    return this.barbershopsService.createInvitation(req.user.id, dto);
  }

  @Delete('team/invitations/:invitationId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  revokeInvitation(@Request() req: { user: { id: string } }, @Param('invitationId') invitationId: string) {
    return this.barbershopsService.revokeInvitation(req.user.id, invitationId);
  }

  @Get('team/:barberId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  getTeamMemberDetail(@Request() req: { user: { id: string } }, @Param('barberId') barberId: string) {
    return this.barbershopsService.getTeamMemberDetail(req.user.id, barberId);
  }

  @Patch('team/:barberId/commission')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  updateCommission(
    @Request() req: { user: { id: string } },
    @Param('barberId') barberId: string,
    @Body() dto: UpdateCommissionDto,
  ) {
    return this.barbershopsService.updateCommission(req.user.id, barberId, dto);
  }

  @Delete('team/:barberId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  removeTeamMember(@Request() req: { user: { id: string } }, @Param('barberId') barberId: string) {
    return this.barbershopsService.removeTeamMember(req.user.id, barberId);
  }

  // ── Dashboard ──

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBERSHOP_OWNER)
  getDashboard(@Request() req: { user: { id: string } }, @Query() query: DashboardQueryDto) {
    const year = query.year ? Number(query.year) : undefined;
    return this.barbershopsService.getDashboard(req.user.id, query.scope, query.period, year);
  }

  // ── Public ──

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.barbershopsService.findOne(id);
  }
}
