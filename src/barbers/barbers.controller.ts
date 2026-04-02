import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { BarbersService } from './barbers.service';
import { AvailabilityService } from '../availability/availability.service';
import { UpsertAvailabilityDto } from '../availability/dto/upsert-availability.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { UpdateBarberProfileDto } from './dto/update-barber-profile.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

class FindBarbersQuery {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  radius?: number;
}

@Controller('v1/barbers')
export class BarbersController {
  constructor(
    private readonly barbersService: BarbersService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  @Get()
  findAll(@Query() query: FindBarbersQuery) {
    return this.barbersService.findAll(query.lat, query.lng, query.radius);
  }

  // ── Protected: barber self-management (/me before /:id to avoid route clash) ──

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER)
  getMe(@Request() req: any) {
    return this.barbersService.findMe(req.user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER)
  updateMe(@Request() req: any, @Body() dto: UpdateBarberProfileDto) {
    return this.barbersService.updateMe(req.user.id, dto);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadAvatar(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.barbersService.uploadAvatar(req.user.id, file);
  }

  @Post('me/services')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER)
  createService(@Request() req: any, @Body() dto: CreateServiceDto) {
    return this.barbersService.createService(req.user.id, dto);
  }

  @Patch('me/services/:serviceId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER)
  updateService(
    @Request() req: any,
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.barbersService.updateService(req.user.id, serviceId, dto);
  }

  @Delete('me/services/:serviceId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER)
  deleteService(@Request() req: any, @Param('serviceId') serviceId: string) {
    return this.barbersService.deleteService(req.user.id, serviceId);
  }

  // ── Availability ──

  @Patch('me/availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER)
  upsertAvailability(@Request() req: any, @Body() dto: UpsertAvailabilityDto) {
    return this.availabilityService.upsertForBarber(req.user.id, dto.slots);
  }

  // ── Public ──

  @Get(':id/availability')
  getAvailability(@Param('id') barberId: string) {
    return this.availabilityService.findByBarberId(barberId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.barbersService.findOne(id);
  }
}
