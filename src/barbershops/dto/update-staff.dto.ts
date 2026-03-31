import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateStaffDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100) barberPercent?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) shopPercent?: number;
  @IsOptional() @IsBoolean()                  isActive?: boolean;
}
