import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CreditsService } from './credits.service';
import { GrantCreditsDto } from './dto/grant-credits.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

interface JwtUser {
  id: string;
  email: string;
  role: Role;
}

@Controller('v1/credits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  // GET /api/v1/credits/balance
  @Get('balance')
  async getBalance(@Request() req: { user: JwtUser }) {
    const data = await this.creditsService.getBalance(req.user.id);
    return { data, message: 'Saldo de créditos', statusCode: 200 };
  }

  // GET /api/v1/credits/history?limit=50&offset=0
  @Get('history')
  async getHistory(
    @Request() req: { user: JwtUser },
    @Query() query: HistoryQueryDto,
  ) {
    const data = await this.creditsService.getHistory(
      req.user.id,
      query.limit,
      query.offset,
    );
    return { data, message: 'Historial de créditos', statusCode: 200 };
  }

  // POST /api/v1/credits/grant (solo ADMIN)
  @Post('grant')
  @Roles(Role.ADMIN)
  async grant(
    @Body() dto: GrantCreditsDto,
    @Request() req: { user: JwtUser },
  ) {
    const data = await this.creditsService.grantByAdmin({
      userId: dto.userId,
      amount: dto.amount,
      description: dto.description,
      adminId: req.user.id,
      metadata: dto.metadata,
    });
    return { data, message: 'Créditos otorgados exitosamente', statusCode: 201 };
  }

  // GET /api/v1/credits/admin/users/:userId/balance (solo ADMIN)
  @Get('admin/users/:userId/balance')
  @Roles(Role.ADMIN)
  async getAdminUserBalance(@Param('userId') userId: string) {
    const data = await this.creditsService.getAdminUserBalance(userId);
    return { data, message: 'Saldo del usuario', statusCode: 200 };
  }
}
