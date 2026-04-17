import { IsEnum, IsOptional, IsDateString } from 'class-validator';

export enum DashboardPeriod {
  TODAY = 'today',
  WEEK = 'week',
  MONTH = 'month',
  LAST_MONTH = 'last_month',
  CUSTOM = 'custom',
}

export class DashboardQueryDto {
  @IsEnum(DashboardPeriod)
  period: DashboardPeriod;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
