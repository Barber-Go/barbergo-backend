import { IsString, IsInt, Min, IsOptional, IsObject } from 'class-validator';

export class GrantCreditsDto {
  @IsString()
  userId: string;

  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  description: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
