import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { BlockType } from '../../generated/prisma/enums';

export class CreateBlockDto {
  @IsEnum(BlockType)
  type: BlockType;

  @IsOptional()
  @IsString()
  label?: string;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;
}
