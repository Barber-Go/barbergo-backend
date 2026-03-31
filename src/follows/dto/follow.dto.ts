import { IsEnum, IsString } from 'class-validator';
import { PublicEntityType } from '../../generated/prisma/enums';

export class FollowDto {
  @IsEnum(PublicEntityType)
  followedType: PublicEntityType;

  @IsString()
  followedId: string;
}
