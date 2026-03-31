import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
import { CommunityCategory } from '../../generated/prisma/enums';

export class CreateCommunityDto {
  @IsString()                        name: string;
  @IsOptional() @IsString()          description?: string;
  @IsEnum(CommunityCategory)         category: CommunityCategory;
  @IsOptional() @IsUrl()             coverUrl?: string;
  @IsOptional() @IsBoolean()         isPublic?: boolean;
}
