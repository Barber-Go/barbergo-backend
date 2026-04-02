import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmWebpayPaymentDto {
  @IsString()
  @IsNotEmpty()
  token_ws: string;
}
