import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CancellationReason } from '../../generated/prisma/enums';

export class CancelBookingDto {
  @IsEnum(CancellationReason)
  reason: CancellationReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
