import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListPostsQueryDto {
  @IsOptional() @IsInt() @Min(1)         @Type(() => Number) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) @Type(() => Number) limit?: number;
}
