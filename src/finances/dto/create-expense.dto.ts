import { IsDateString, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateExpenseDto {
  @IsString()                 category: string;
  @IsOptional() @IsString()   description?: string;
  @IsNumber() @IsPositive()   amount: number;
  @IsDateString()             date: string;
  @IsOptional() @IsString()   receiptUrl?: string;
  @IsOptional() @IsString()   barbershopId?: string;
}

export class UpdateExpenseDto {
  @IsOptional() @IsString()   category?: string;
  @IsOptional() @IsString()   description?: string;
  @IsOptional() @IsNumber() @IsPositive() amount?: number;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString()   barbershopId?: string;
}

export class ExpenseListQueryDto {
  @IsOptional() @IsString() barbershopId?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class FinanceSummaryQueryDto {
  @IsOptional() @IsString() period?: string;
  @IsOptional() @IsString() barbershopId?: string;
}

export class LedgerMonthQueryDto {
  @IsOptional() @IsString() barbershopId?: string;
  @IsOptional() @IsString() month?: string; // YYYY-MM
}
