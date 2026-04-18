import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DashboardPeriod } from './dashboard-query.dto';

export class TeamQueryDto {
  @IsString()
  scope: string; // 'all' or a barbershop CUID

  @IsOptional()
  @IsEnum(DashboardPeriod)
  period?: DashboardPeriod;
}
