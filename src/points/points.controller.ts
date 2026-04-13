import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { PointsService } from './points.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/points')
export class PointsController {
  constructor(private readonly pointsService: PointsService) {}

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  getBalance(@Request() req: { user: { id: string } }) {
    return this.pointsService.getBalance(req.user.id);
  }

  @Get('rewards')
  @UseGuards(JwtAuthGuard)
  getRewards() {
    return this.pointsService.getRewards();
  }
}
