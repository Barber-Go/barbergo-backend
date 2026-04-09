import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AddStaffDto {
  @IsOptional() @IsString()  barberProfileId?: string;
  @IsOptional() @IsString()  role?: string;
  @IsOptional() @IsString()  name?: string;
  @IsOptional() @IsString()  rut?: string;
  @IsOptional() @IsNumber()  barberPercent?: number;
}
