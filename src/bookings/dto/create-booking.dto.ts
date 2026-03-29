import { IsDateString, IsEnum, IsString } from 'class-validator';
import { PaymentMethod } from '../../generated/prisma/enums';

export class CreateBookingDto {
  @IsString()
  barberId: string;

  @IsString()
  serviceId: string;

  @IsDateString()
  scheduledAt: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
