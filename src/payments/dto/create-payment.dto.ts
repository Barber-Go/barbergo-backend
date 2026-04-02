import { IsNotEmpty, IsString, IsNumber, IsUrl, Min } from 'class-validator';

export class CreateWebpayPaymentDto {
  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  returnUrl: string;
}
