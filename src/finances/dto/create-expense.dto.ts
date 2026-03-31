import { IsDateString, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateExpenseDto {
  @IsString()                 category: string;
  @IsOptional() @IsString()   description?: string;
  @IsNumber() @IsPositive()   amount: number;
  @IsDateString()             date: string;
  @IsOptional() @IsString()   receiptUrl?: string;
}
