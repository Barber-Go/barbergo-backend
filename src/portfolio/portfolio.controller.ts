import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { CreatePortfolioItemDto, AddMediaDto } from './dto/create-portfolio-item.dto';
import { UpdatePortfolioItemDto } from './dto/update-portfolio-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('v1/portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get(':barberId')
  findByBarberId(@Param('barberId') barberId: string) {
    return this.portfolioService.findByBarberId(barberId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  create(@Request() req: any, @Body() dto: CreatePortfolioItemDto) {
    return this.portfolioService.create(req.user.id, dto);
  }

  @Patch(':itemId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  update(@Request() req: any, @Param('itemId') itemId: string, @Body() dto: UpdatePortfolioItemDto) {
    return this.portfolioService.update(req.user.id, itemId, dto);
  }

  @Post(':itemId/media')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  addMedia(@Request() req: any, @Param('itemId') itemId: string, @Body() dto: AddMediaDto) {
    return this.portfolioService.addMedia(req.user.id, itemId, dto);
  }

  @Delete(':itemId/media/:mediaId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  removeMedia(@Request() req: any, @Param('mediaId') mediaId: string) {
    return this.portfolioService.removeMedia(req.user.id, mediaId);
  }

  @Delete(':itemId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE)
  deleteItem(@Request() req: any, @Param('itemId') itemId: string) {
    return this.portfolioService.deleteItem(req.user.id, itemId);
  }
}
