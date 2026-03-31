import { IsOptional, IsString } from 'class-validator';

export class UpdatePortfolioItemDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
}
