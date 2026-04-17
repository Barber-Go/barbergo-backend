import { IsEnum, IsString } from 'class-validator';

export enum DashboardPeriod {
  TODAY = 'today',
  WEEK = 'week',
  MONTH = 'month',
  LAST_MONTH = 'last_month',
}

export class DashboardQueryDto {
  @IsString()
  scope: string; // 'all' or a barbershop CUID

  @IsEnum(DashboardPeriod)
  period: DashboardPeriod;
}
