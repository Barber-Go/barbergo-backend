import { IsNumber, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class CreateBarbershopDto {
  @IsString() @MinLength(3) @MaxLength(100)
  name: string;

  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsString()  address?: string;
  @IsOptional() @IsString()  comuna?: string;
  @IsOptional() @IsNumber()  lat?: number;
  @IsOptional() @IsNumber()  lng?: number;
  @IsOptional() @IsString()  phone?: string;
  @IsOptional() @IsString()  logoUrl?: string;
  @IsOptional() @IsString()  coverUrl?: string;
}
