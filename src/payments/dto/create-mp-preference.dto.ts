import { IsNotEmpty, IsString, IsNumber, Min } from 'class-validator';

export class CreateMpPreferenceDto {
  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  backUrl: string;
}
