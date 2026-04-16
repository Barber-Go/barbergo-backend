import { IsString, IsOptional, IsNotEmpty, Matches } from 'class-validator';

export class CreateManualBookingDto {
  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  serviceName?: string;

  @IsString()
  @IsNotEmpty()
  date: string; // YYYY-MM-DD

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  startTime: string; // HH:MM

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  endTime: string; // HH:MM

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;
}
