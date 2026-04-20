import { IsEnum } from 'class-validator';
import { BarbershopStatus } from '../../generated/prisma/enums';

export class UpdateBarbershopStatusDto {
  @IsEnum(BarbershopStatus)
  status: BarbershopStatus;
}
