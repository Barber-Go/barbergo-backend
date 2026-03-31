import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PublicEntityType } from '../../generated/prisma/enums';

export class SearchQueryDto {
  @IsOptional() @IsNumber() @Type(() => Number)       lat?: number;
  @IsOptional() @IsNumber() @Type(() => Number)       lng?: number;
  @IsOptional() @IsNumber() @Min(0.1) @Type(() => Number) radius?: number;
  @IsOptional() @IsEnum(PublicEntityType)              type?: PublicEntityType;
  @IsOptional() @IsString()                            service?: string;
}

export class ViewportQueryDto {
  @IsNumber() @Type(() => Number) minLat: number;
  @IsNumber() @Type(() => Number) maxLat: number;
  @IsNumber() @Type(() => Number) minLng: number;
  @IsNumber() @Type(() => Number) maxLng: number;
  @IsOptional() @IsEnum(PublicEntityType) type?: PublicEntityType;
}
