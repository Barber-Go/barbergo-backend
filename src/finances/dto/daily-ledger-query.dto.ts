import { IsDateString } from 'class-validator';

export class DailyLedgerQueryDto {
  @IsDateString() date: string;
}
