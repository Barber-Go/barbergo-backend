import { IsEnum, IsOptional } from 'class-validator';

export enum EmployeeDashboardPeriod {
  TODAY = 'today',
  WEEK = 'week',
  MONTH = 'month',
  LAST_MONTH = 'last_month',
}

export class EmployeeDashboardQueryDto {
  @IsOptional()
  @IsEnum(EmployeeDashboardPeriod)
  period?: EmployeeDashboardPeriod = EmployeeDashboardPeriod.MONTH;
}
