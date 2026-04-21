import { IsString, IsInt, Min, Max, IsOptional, IsArray } from 'class-validator';

export class CreateTipDto {
  @IsString()
  bookingId: string;

  @IsInt()
  @Min(0)
  @Max(100000)
  amount: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  compliments?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  issues?: string[];
}
