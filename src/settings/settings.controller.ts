import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(@Request() req: any) {
    return this.settingsService.get(req.user.id);
  }

  @Patch()
  upsert(@Request() req: any, @Body() dto: UpdateSettingsDto) {
    return this.settingsService.upsert(req.user.id, dto);
  }
}
