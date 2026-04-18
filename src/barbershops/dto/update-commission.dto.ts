import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCommissionDto {
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  barberPercent: number;

  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  shopPercent: number;
}
