import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUrl, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MediaType } from '../../generated/prisma/enums';

export class AddMediaDto {
  @IsEnum(MediaType)                    type: MediaType;
  @IsString()                           url: string;
  @IsOptional() @IsString()             thumbnailUrl?: string;
  @IsOptional() @IsInt() @Min(0)        sortOrder?: number;
}

export class CreatePortfolioItemDto {
  @IsOptional() @IsString()             title?: string;
  @IsOptional() @IsString()             description?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddMediaDto)
  media?: AddMediaDto[];
}
