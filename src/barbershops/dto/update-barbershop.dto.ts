import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateBarbershopDto {
  @IsOptional() @IsString()  name?: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsString()  address?: string;
  @IsOptional() @IsNumber()  lat?: number;
  @IsOptional() @IsNumber()  lng?: number;
  @IsOptional() @IsString()  phone?: string;
  @IsOptional() @IsString()  logoUrl?: string;
  @IsOptional() @IsString()  coverUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
